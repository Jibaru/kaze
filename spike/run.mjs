/**
 * Kaze Phase 0 spike.
 *
 * Proves, before a single line of Electron exists, that the session model works:
 *
 *   1. The app can drive the *installed* Claude Code with no API key (OAuth).
 *   2. A workspace-local skill is discovered and fires.
 *   3. A read-only tool allowlist means zero permission prompts.
 *   4. A session survives process exit and `resume` carries the context.
 *
 * Run: node run.mjs
 */

import { query } from '@anthropic-ai/claude-agent-sdk'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))
const cwd = join(here, 'workspace')

const ALLOWED = ['Read', 'Grep', 'Glob', 'Skill']

/**
 * NOTE: `canUseTool` is the allowlist, and these names deliberately do NOT go
 * into `allowedTools`. A bare `allowedTools` entry auto-approves the tool
 * *before* the callback is consulted, which silently turns the backstop into a
 * no-op (the SDK warns: CLAUDE_SDK_CAN_USE_TOOL_SHADOWED). Allow rules in the
 * user's own settings files shadow it the same way, without any warning — so
 * the write tools get a hard `disallowedTools` deny, which nothing overrides.
 */
const denials = []
const canUseTool = async (toolName, input) => {
  if (ALLOWED.includes(toolName) || toolName.startsWith('mcp__aws-knowledge__')) {
    return { behavior: 'allow', updatedInput: input }
  }
  denials.push(toolName)
  return { behavior: 'deny', message: `kaze: ${toolName} is not on the reviewer's allowlist` }
}

const baseOptions = {
  cwd,
  // 'project' only. Loading 'user' drags the whole global config into the
  // reviewer: every MCP server the user has configured, plus their permission
  // allow-rules (which silently shadow canUseTool). A review session has no
  // business holding tools that can delete a database.
  settingSources: ['project'],
  strictMcpConfig: true,
  skills: ['kaze-spike'],
  // Deny rules are the only layer nothing overrides. Three groups: tools that
  // write, tools that reach the network, and tools that orchestrate (a reviewer
  // has no business spawning agents, scheduling crons or messaging anyone).
  disallowedTools: [
    'Bash', 'PowerShell', 'Write', 'Edit', 'NotebookEdit',
    'WebFetch', 'WebSearch',
    'Task', 'Workflow', 'CronCreate', 'CronDelete', 'CronList', 'RemoteTrigger',
    'SendMessage', 'ListAgents', 'PushNotification', 'ScheduleWakeup', 'Monitor',
    'EnterWorktree', 'ExitWorktree', 'EnterPlanMode', 'ExitPlanMode',
    'TaskOutput', 'TaskStop', 'DesignSync', 'ReportFindings', 'AskUserQuestion',
  ],
  permissionMode: 'default',
  canUseTool,
  includePartialMessages: true,
}

/** Drive one turn to completion, collecting everything the harness cares about. */
async function turn(prompt, { resume } = {}) {
  const seen = { text: '', tools: [], offered: [], sessionId: null, costUSD: null, isError: false, deltas: 0 }

  for await (const msg of query({ prompt, options: { ...baseOptions, resume } })) {
    if (msg.type === 'system' && msg.subtype === 'init') {
      seen.sessionId = msg.session_id
      seen.offered = msg.tools ?? []
    } else if (msg.type === 'stream_event') {
      // Proves we can stream text into a UI transcript rather than waiting.
      if (msg.event?.type === 'content_block_delta') seen.deltas++
    } else if (msg.type === 'assistant') {
      for (const block of msg.message.content ?? []) {
        if (block.type === 'text') seen.text += block.text
        if (block.type === 'tool_use') seen.tools.push(block.name)
      }
    } else if (msg.type === 'result') {
      seen.sessionId ??= msg.session_id
      seen.costUSD = msg.total_cost_usd ?? null
      seen.isError = msg.subtype !== 'success'
      if (msg.subtype !== 'success') seen.text += `\n[result: ${msg.subtype}]`
    }
  }
  return seen
}

const checks = []
const check = (name, pass, detail = '') => {
  checks.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

console.log(`cwd: ${cwd}\n`)

check(
  'no ANTHROPIC_API_KEY in env (proves OAuth path)',
  !process.env.ANTHROPIC_API_KEY,
  process.env.ANTHROPIC_API_KEY ? 'key present — unset it and re-run' : 'unset',
)

console.log('\n--- turn 1: review ---')
const t1 = await turn('Use the kaze-spike skill to review design.md.')
console.log(t1.text.trim() + '\n')

check('turn 1 succeeded', !t1.isError)
check('captured a session id', Boolean(t1.sessionId), t1.sessionId ?? '')
check('skill loaded and fired', t1.text.includes('KAZE-SPIKE-OK'), `tools: ${t1.tools.join(', ') || 'none'}`)
check('read the design off disk', t1.tools.includes('Read'))
check(
  'session is scoped down to a read-only reviewer',
  t1.offered.every((t) => ['Read', 'Grep', 'Glob', 'Skill', 'ToolSearch'].includes(t) || t.startsWith('mcp__aws-knowledge__')),
  `offered: ${t1.offered.join(', ')}`,
)

check('streamed text deltas', t1.deltas > 0, `${t1.deltas} deltas`)
check('flagged the single-AZ database (n5)', /n5|links-db/i.test(t1.text))

console.log('\n--- turn 2: resume the same session, new process-level call ---')
const t2 = await turn(
  'Without reading any files again, tell me: which node id did you flag, and what was the issue?',
  { resume: t1.sessionId },
)
console.log(t2.text.trim() + '\n')

check('turn 2 succeeded', !t2.isError)
check('resume carried the context', /n5|links-db/i.test(t2.text) && !t2.tools.includes('Read'), `tools: ${t2.tools.join(', ') || 'none'}`)
check('review turns never hit the backstop', denials.length === 0, denials.join(', '))

console.log('\n--- turn 3: the reviewer must not be able to write ---')
const t3 = await turn('Create a file called hack.txt in this directory containing the word "pwned".', {
  resume: t2.sessionId,
})
console.log(t3.text.trim() + '\n')

const hackExists = existsSync(join(cwd, 'hack.txt'))
check('no file was written', !hackExists, hackExists ? 'hack.txt EXISTS — clean it up' : 'hack.txt absent')

const cost = (t1.costUSD ?? 0) + (t2.costUSD ?? 0) + (t3.costUSD ?? 0)
console.log(`\ncost: $${cost.toFixed(4)}`)

const failed = checks.filter((c) => !c.pass)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)
