import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { resolveInstalledClaude } from './resolve-claude'
import { FAST_MODEL } from './fast-review'
import type { ReviewEvent, TurnIntent } from '../shared/types'

/**
 * Drives the user's installed Claude Code.
 *
 * Everything in the options below was established by `spike/run.mjs`, including
 * two things that are easy to get wrong and silent when you do:
 *
 *   - `canUseTool` is the allowlist and `allowedTools` stays EMPTY. A bare name
 *     in `allowedTools` auto-approves the tool before the callback runs, and
 *     allow-rules in the user's own settings shadow it the same way without
 *     warning. `disallowedTools` is the only layer nothing overrides.
 *   - `settingSources: ['project']`, never 'user'. Loading user settings drags
 *     every MCP server on the machine into a session whose entire job is reading
 *     a YAML file — including, on this machine, servers that can delete
 *     databases.
 *
 * The offered toolset is asserted on every session, not assumed.
 */

/**
 * The SDK is ESM-only and the main bundle is CJS (so the preload can stay
 * sandboxed), so it is loaded on first use rather than required at module load.
 */
type QueryFn = typeof import('@anthropic-ai/claude-agent-sdk').query
let cachedQuery: QueryFn | null = null
async function loadQuery(): Promise<QueryFn> {
  cachedQuery ??= (await import('@anthropic-ai/claude-agent-sdk')).query
  return cachedQuery
}

const ALLOWED = ['Read', 'Grep', 'Glob', 'Skill', 'ToolSearch']
const ALLOWED_MCP_PREFIX = 'mcp__aws-knowledge__'

const DISALLOWED = [
  // writes
  'Bash', 'PowerShell', 'Write', 'Edit', 'NotebookEdit',
  // network
  'WebFetch', 'WebSearch',
  // orchestration: a reviewer has no business spawning agents or messaging anyone
  'Task', 'Workflow', 'CronCreate', 'CronDelete', 'CronList', 'RemoteTrigger',
  'SendMessage', 'ListAgents', 'PushNotification', 'ScheduleWakeup', 'Monitor',
  'EnterWorktree', 'ExitWorktree', 'EnterPlanMode', 'ExitPlanMode',
  'TaskOutput', 'TaskStop', 'DesignSync', 'ReportFindings', 'AskUserQuestion',
]

/**
 * A fast turn offers no tools whatsoever, so everything the full profile allows
 * is named here alongside the hard denies, plus the handful the CLI hands over
 * without being asked. Nothing here is a judgement call: the prompt already
 * carries every file the reviewer would have opened, and a tool call is a round
 * trip that fast mode exists to avoid.
 */
const FAST_DISALLOWED = [
  ...DISALLOWED,
  ...ALLOWED,
  'TodoWrite', 'SlashCommand', 'BashOutput', 'KillShell', 'Artifact',
]

/**
 * Passing this to `send` selects the fast profile. It is the whole switch: a
 * turn either has a system prompt of its own, no tools and its own short-lived
 * conversation, or it is an ordinary one.
 */
export interface FastTurn {
  /** Replaces the Claude Code preset outright. */
  system: string
  /** Start the fast conversation over. A review is a fresh judgement. */
  fresh?: boolean
}

export interface SessionManagerOptions {
  cwd: string
  /** Override the CLI to drive. Defaults to the one on the user's PATH. */
  claudePath?: string | undefined
  /** Emitted as the turn streams. The renderer never sees the SDK directly. */
  emit: (event: ReviewEvent) => void
  /** Wire in the AWS Knowledge MCP server. Best-effort: never fails a review. */
  useKnowledgeServer?: boolean
}

export class SessionManager {
  private sessionId: string | null = null
  /**
   * Fast turns run in their own conversation, kept apart from the attempt's.
   * Mixing them would put a toolless, system-prompt-replaced turn in the middle
   * of the transcript the slow reviewer resumes, and it is never written to
   * disk: it is worth continuing across a couple of follow-up questions, and
   * worth nothing after a restart.
   */
  private fastSessionId: string | null = null
  private abort: AbortController | null = null
  private readonly cwd: string
  private readonly emit: (event: ReviewEvent) => void
  private readonly useKnowledgeServer: boolean
  /** The user's own install, or undefined to let the SDK use its bundled CLI. */
  readonly claudePath: string | undefined

  constructor(options: SessionManagerOptions) {
    this.cwd = options.cwd
    this.emit = options.emit
    this.useKnowledgeServer = options.useKnowledgeServer ?? true
    this.claudePath = options.claudePath ?? resolveInstalledClaude()
  }

  get currentSessionId(): string | null {
    return this.sessionId
  }

  get busy(): boolean {
    return this.abort !== null
  }

  /** Barge-in. Safe to call when idle. */
  cancel(): void {
    this.abort?.abort()
    this.abort = null
  }

  /** Start a fresh conversation while keeping the workspace and its ledger. */
  reset(): void {
    this.cancel()
    this.sessionId = null
    this.fastSessionId = null
  }

  /** Continue a conversation from a previous run of the app. */
  adopt(sessionId: string | undefined): void {
    if (sessionId) this.sessionId = sessionId
  }

  private options(): Options {
    const base: Options = {
      cwd: this.cwd,
      settingSources: ['project'],
      strictMcpConfig: true,
      skills: ['kaze-review'],
      disallowedTools: DISALLOWED,
      permissionMode: 'default',
      includePartialMessages: true,
      canUseTool: async (toolName, input) => {
        if (ALLOWED.includes(toolName) || toolName.startsWith(ALLOWED_MCP_PREFIX)) {
          return { behavior: 'allow', updatedInput: input }
        }
        return { behavior: 'deny', message: `kaze: ${toolName} is not on the reviewer's allowlist` }
      },
    }
    if (this.useKnowledgeServer) {
      base.mcpServers = {
        'aws-knowledge': { type: 'http', url: 'https://knowledge-mcp.global.api.aws' },
      }
    }
    if (this.claudePath) base.pathToClaudeCodeExecutable = this.claudePath
    if (this.sessionId) base.resume = this.sessionId
    return base
  }

  /**
   * The lean profile. Every line here removes something that costs time before
   * the first word of the review:
   *
   *   - `settingSources: []` — no project settings, so no skill to open and no
   *     MCP server to connect. The skill's rules are in the system prompt.
   *   - `systemPrompt: custom` — the Claude Code preset is written for an agent
   *     with a filesystem and twenty tools. This turn has neither.
   *   - `thinking: disabled` and `effort: 'low'` — a review of five boxes
   *     against a brief that is quoted in full does not need to be reasoned out
   *     first, and thinking is pure latency you watch happen.
   *   - `maxTurns: 1` — there is nothing to do but answer, so a second turn
   *     could only be the model trying a tool it does not have.
   *
   * `canUseTool` stays as the deny-everything backstop it is in the full
   * profile; `FAST_DISALLOWED` is the layer nothing overrides.
   */
  private fastOptions(system: string): Options {
    const base: Options = {
      cwd: this.cwd,
      settingSources: [],
      strictMcpConfig: true,
      disallowedTools: FAST_DISALLOWED,
      systemPrompt: { type: 'custom', prompt: system },
      model: FAST_MODEL,
      thinking: { type: 'disabled' },
      effort: 'low',
      maxTurns: 1,
      permissionMode: 'default',
      includePartialMessages: true,
      canUseTool: async (toolName) => ({
        behavior: 'deny',
        message: `kaze: a fast turn has no tools; ${toolName} is unavailable`,
      }),
    }
    if (this.claudePath) base.pathToClaudeCodeExecutable = this.claudePath
    if (this.fastSessionId) base.resume = this.fastSessionId
    return base
  }

  /**
   * Run one turn to completion. Resolves with the assistant's full text.
   * Throws only on a genuine failure; a cancelled turn resolves with what it
   * had, so a barge-in still leaves a readable transcript.
   */
  async send(prompt: string, intent: TurnIntent, fast?: FastTurn): Promise<string> {
    if (this.abort) throw new Error('a turn is already in flight')
    const abort = new AbortController()
    this.abort = abort
    if (fast?.fresh) this.fastSessionId = null

    let text = ''
    this.emit({ kind: 'turn-start', intent })

    try {
      const query = await loadQuery()
      const options = fast ? this.fastOptions(fast.system) : this.options()
      for await (const message of query({ prompt, options: { ...options, abortController: abort } })) {
        if (abort.signal.aborted) break
        this.consume(message, Boolean(fast), (chunk) => {
          // Separate blocks are separate paragraphs. Concatenated flush, a
          // block that opens with a heading lands mid-line — "…the ledger.##
          // Revisión" — and markdown never sees a heading at all.
          if (text && !text.endsWith('\n\n')) text += '\n\n'
          text += chunk
        })
      }
    } catch (err) {
      if (!abort.signal.aborted) {
        this.emit({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
        throw err
      }
    } finally {
      this.abort = null
      this.emit({ kind: 'turn-end', intent, cancelled: abort.signal.aborted })
    }

    return text
  }

  private consume(message: SDKMessage, fast: boolean, appendText: (chunk: string) => void): void {
    if (message.type === 'system' && message.subtype === 'init') {
      const offered = message.tools ?? []
      // The toolset is a security boundary and the defaults are wide. Say so
      // loudly rather than discovering it in a transcript later. A fast turn
      // expects none at all, which also means this is the check that would
      // notice the day fast mode stopped actually being toolless.
      const unexpected = fast
        ? offered
        : offered.filter((t) => !ALLOWED.includes(t) && !t.startsWith(ALLOWED_MCP_PREFIX))
      if (unexpected.length > 0) {
        this.emit({
          kind: 'warning',
          message: `session offers unexpected tools: ${unexpected.join(', ')}`,
        })
      }

      if (fast) {
        // Not emitted: the caller persists this id as the attempt's
        // conversation, and resuming a toolless turn as the full reviewer is
        // exactly the kind of quiet mix-up that would be hard to see later.
        this.fastSessionId = message.session_id
        return
      }
      this.sessionId = message.session_id
      this.emit({ kind: 'session', sessionId: message.session_id })
      return
    }

    if (message.type === 'stream_event') {
      const event = message.event as { type?: string; delta?: { type?: string; text?: string } }
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) {
        this.emit({ kind: 'delta', text: event.delta.text })
      }
      return
    }

    if (message.type === 'assistant') {
      for (const block of message.message.content ?? []) {
        if (block.type === 'text') appendText(block.text)
        if (block.type === 'tool_use') this.emit({ kind: 'tool', name: block.name })
      }
      return
    }

    if (message.type === 'result') {
      if (fast) this.fastSessionId ??= message.session_id
      else this.sessionId ??= message.session_id
      this.emit({
        kind: 'result',
        ok: message.subtype === 'success',
        costUSD: message.total_cost_usd ?? null,
        durationMs: message.duration_ms ?? null,
      })
    }
  }
}
