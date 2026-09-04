import type { Options, Query, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { resolveInstalledClaude } from './resolve-claude'
import { FAST_MODEL } from './fast-review'

/**
 * One conversation, one process, kept alive between turns.
 *
 * `SessionManager` starts a query per turn and resumes by session id. That is
 * right for a review — the turns are minutes apart and a resumed session is
 * exactly what you want after a restart — but measured here it cost about two
 * seconds before the first token, most of it spent launching the CLI and
 * loading a conversation that had been alive ninety seconds earlier.
 *
 * Two seconds is a lot of a five-second turn, and it is silence in the middle
 * of a conversation. So conversation mode uses the SDK's streaming input mode
 * instead: one `query()` for the whole session, fed by a queue, with the
 * process and the loaded context staying put between turns.
 *
 * It is a separate class rather than a mode on `SessionManager` on purpose. The
 * reviewer is the part of this app with a security boundary worth defending,
 * and its options are asserted on every session; nothing here should be able to
 * change how that one is configured by accident. The toolset is still asserted,
 * and it is still empty.
 */

type QueryFn = typeof import('@anthropic-ai/claude-agent-sdk').query
let cachedQuery: QueryFn | null = null
async function loadQuery(): Promise<QueryFn> {
  cachedQuery ??= (await import('@anthropic-ai/claude-agent-sdk')).query
  return cachedQuery
}

/** An async iterable you can push into. The SDK reads it; `say` writes it. */
class Pushable<T> implements AsyncIterable<T> {
  private readonly items: T[] = []
  private waiting: ((result: IteratorResult<T>) => void) | null = null
  private closed = false

  push(item: T): void {
    if (this.closed) return
    const waiting = this.waiting
    if (waiting) {
      this.waiting = null
      waiting({ value: item, done: false })
    } else {
      this.items.push(item)
    }
  }

  close(): void {
    this.closed = true
    const waiting = this.waiting
    this.waiting = null
    waiting?.({ value: undefined as never, done: true })
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const next = this.items.shift()
        if (next !== undefined) return Promise.resolve({ value: next, done: false })
        if (this.closed) return Promise.resolve({ value: undefined as never, done: true })
        return new Promise((resolve) => {
          this.waiting = resolve
        })
      },
    }
  }
}

export interface LiveSessionOptions {
  cwd: string
  /** Replaces the Claude Code preset outright, as in the fast profile. */
  system: string
  /** Everything the CLI must not offer. This session has no tools at all. */
  disallowedTools: string[]
  claudePath?: string | undefined
  /** Warnings worth surfacing — an unexpected tool, a session that fell over. */
  onWarning: (message: string) => void
}

export class LiveSession {
  private readonly options: LiveSessionOptions
  private input: Pushable<SDKUserMessage> | null = null
  private stream: Query | null = null
  private pump: Promise<void> | null = null
  /** The turn in flight. Only ever one: you cannot interrupt yourself. */
  private turn: {
    resolve: (text: string) => void
    reject: (err: Error) => void
    onDelta: (chunk: string) => void
    text: string
  } | null = null

  constructor(options: LiveSessionOptions) {
    this.options = { ...options, claudePath: options.claudePath ?? resolveInstalledClaude() }
  }

  get open(): boolean {
    return this.stream !== null
  }

  /**
   * Say something and wait for the whole reply.
   *
   * The first call starts the process; every one after it costs nothing but the
   * round trip. A failure closes the session rather than leaving a half-dead
   * one behind — the next turn opens a new one, which is a second of latency
   * once, rather than a conversation that has quietly stopped working.
   */
  async say(text: string, onDelta: (chunk: string) => void): Promise<string> {
    if (this.turn) throw new Error('a turn is already in flight')
    if (!this.stream) this.start()

    const reply = new Promise<string>((resolve, reject) => {
      this.turn = { resolve, reject, onDelta, text: '' }
    })
    this.input!.push({
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
      session_id: '',
    } as SDKUserMessage)

    try {
      return await reply
    } catch (err) {
      this.close()
      throw err
    }
  }

  close(): void {
    this.turn?.reject(new Error('the conversation was closed'))
    this.turn = null
    this.input?.close()
    this.input = null
    this.stream = null
    this.pump = null
  }

  private start(): void {
    const input = new Pushable<SDKUserMessage>()
    this.input = input

    this.pump = (async () => {
      try {
        const query = await loadQuery()
        const stream = query({ prompt: input, options: this.sdkOptions() })
        this.stream = stream
        for await (const message of stream) this.consume(message)
      } catch (err) {
        const failure = err instanceof Error ? err : new Error(String(err))
        this.turn?.reject(failure)
        this.turn = null
        this.stream = null
        this.options.onWarning(failure.message)
      }
    })()
    void this.pump
  }

  private sdkOptions(): Options {
    const base: Options = {
      cwd: this.options.cwd,
      // Same reasoning as the fast profile: nothing on disk configures this
      // turn, so there is no skill to open and no MCP server to connect.
      settingSources: [],
      strictMcpConfig: true,
      disallowedTools: this.options.disallowedTools,
      systemPrompt: { type: 'custom', prompt: this.options.system },
      model: FAST_MODEL,
      thinking: { type: 'disabled' },
      effort: 'low',
      permissionMode: 'default',
      includePartialMessages: true,
      canUseTool: async (toolName) => ({
        behavior: 'deny',
        message: `kaze: a conversation turn has no tools; ${toolName} is unavailable`,
      }),
    }
    if (this.options.claudePath) base.pathToClaudeCodeExecutable = this.options.claudePath
    return base
  }

  private consume(message: SDKMessage): void {
    if (message.type === 'system' && message.subtype === 'init') {
      const offered = message.tools ?? []
      // Asserted, not assumed — the same rule the reviewer's session lives by.
      // A conversation turn offers nothing at all.
      if (offered.length > 0) {
        this.options.onWarning(`conversation session offers unexpected tools: ${offered.join(', ')}`)
      }
      return
    }

    if (message.type === 'stream_event') {
      const event = message.event as { type?: string; delta?: { type?: string; text?: string } }
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) {
        this.turn?.onDelta(event.delta.text)
      }
      return
    }

    if (message.type === 'assistant' && this.turn) {
      for (const block of message.message.content ?? []) {
        if (block.type !== 'text') continue
        // Separate blocks are separate paragraphs, as in `SessionManager`.
        if (this.turn.text && !this.turn.text.endsWith('\n\n')) this.turn.text += '\n\n'
        this.turn.text += block.text
      }
      return
    }

    if (message.type === 'result' && this.turn) {
      const turn = this.turn
      this.turn = null
      turn.resolve(turn.text)
    }
  }
}
