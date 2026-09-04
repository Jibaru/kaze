import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { resolveInstalledClaude } from './resolve-claude'
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
  }

  private options(): Options {
    const denied: string[] = []
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
        denied.push(toolName)
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
   * Run one turn to completion. Resolves with the assistant's full text.
   * Throws only on a genuine failure; a cancelled turn resolves with what it
   * had, so a barge-in still leaves a readable transcript.
   */
  async send(prompt: string, intent: TurnIntent): Promise<string> {
    if (this.abort) throw new Error('a turn is already in flight')
    const abort = new AbortController()
    this.abort = abort

    let text = ''
    this.emit({ kind: 'turn-start', intent })

    try {
      const query = await loadQuery()
      for await (const message of query({ prompt, options: { ...this.options(), abortController: abort } })) {
        if (abort.signal.aborted) break
        this.consume(message, (chunk) => {
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

  private consume(message: SDKMessage, appendText: (chunk: string) => void): void {
    if (message.type === 'system' && message.subtype === 'init') {
      this.sessionId = message.session_id
      const offered = message.tools ?? []
      const unexpected = offered.filter(
        (t) => !ALLOWED.includes(t) && !t.startsWith(ALLOWED_MCP_PREFIX),
      )
      // The toolset is a security boundary and the defaults are wide. Say so
      // loudly rather than discovering it in a transcript later.
      if (unexpected.length > 0) {
        this.emit({
          kind: 'warning',
          message: `session offers unexpected tools: ${unexpected.join(', ')}`,
        })
      }
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
      this.sessionId ??= message.session_id
      this.emit({
        kind: 'result',
        ok: message.subtype === 'success',
        costUSD: message.total_cost_usd ?? null,
        durationMs: message.duration_ms ?? null,
      })
    }
  }
}
