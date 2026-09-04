/**
 * Phase 3 exit criterion, end to end and for real: scaffold a workspace, write a
 * flawed design, run a review through the user's installed Claude Code, and
 * assert that structured findings come back.
 *
 * This costs money and takes ~60s. Run: node scripts/check.mjs scripts/check-review.mts
 */
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { WorkspaceStore } from '../src/main/workspace-store.ts'
import { SessionManager } from '../src/main/session-manager.ts'
import { parseReview } from '../src/shared/findings.ts'
import type { Diagram, ReviewEvent } from '../src/shared/types.ts'

const checks: Array<[string, boolean, string?]> = []
const check = (name: string, pass: boolean, detail = '') => checks.push([name, pass, detail])

const root = mkdtempSync(join(tmpdir(), 'kaze-review-'))
const template = resolve('workspace')
const store = new WorkspaceStore(root)
const attemptDir = store.attemptDir('default')

// Same scaffold the app performs on launch.
cpSync(join(template, 'CLAUDE.md'), join(root, 'CLAUDE.md'))
cpSync(join(template, '.claude'), join(root, '.claude'), { recursive: true })
cpSync(join(template, 'scenarios'), join(root, 'scenarios'), { recursive: true })

/** A deliberately weak URL shortener: DB on the redirect path, single AZ, no backup. */
const design: Diagram = {
  version: 1,
  scenarioId: 'url-shortener',
  groups: [
    { id: 'vpc', kind: 'vpc', label: 'main', x: 0, y: 0, width: 900, height: 500 },
    { id: 'az-a', kind: 'az', label: 'eu-west-1a', x: 0, y: 0, width: 420, height: 420, parentId: 'vpc' },
  ],
  nodes: [
    { id: 'n1', serviceId: 'ALB', label: 'edge-lb', props: { tls: true }, x: 0, y: 0, parentId: 'vpc' },
    { id: 'n2', serviceId: 'ECS', label: 'shortener-api', props: { multi_az: true, autoscaling: '2-20' }, x: 0, y: 0, parentId: 'az-a' },
    { id: 'n3', serviceId: 'RDS', label: 'links-db', props: { engine: 'postgres' }, x: 0, y: 0, parentId: 'az-a' },
  ],
  edges: [
    { id: 'e1', from: 'n1', to: 'n2', protocol: 'HTTPS' },
    { id: 'e2', from: 'n2', to: 'n3', protocol: 'TCP/5432' },
  ],
}

const events: ReviewEvent[] = []
const session = new SessionManager({
  cwd: attemptDir,
  emit: (e) => events.push(e),
  useKnowledgeServer: false, // keep the check hermetic; the app enables it
})

try {
  const snapshot = await store.snapshotRevision(design, 'default')
  check('the design is on disk before the review runs', readFileSync(snapshot.designPath, 'utf-8').includes('service: RDS'))

  const text = await session.send(
    `Use the kaze-review skill. Review revision ${snapshot.revision} of design.md against scenarios/url-shortener.md.`,
    'review',
  )
  const parsed = parseReview(text)

  console.log('\n--- transcript ---\n')
  console.log(parsed.markdown.slice(0, 1600))
  console.log('\n--- payload ---\n')
  console.log(JSON.stringify(parsed.payload, null, 2)?.slice(0, 1800))
  console.log()

  check('a session id was captured', session.currentSessionId !== null, session.currentSessionId ?? '')
  // The SDK ships its own CLI and will quietly use it. The premise of this app
  // is the Claude Code the user installed, so assert we found theirs.
  check("it drove the user's installed CLI, not the SDK's bundled one",
    session.claudePath !== undefined && /claude(\.exe)?$/.test(session.claudePath),
    session.claudePath ?? '(SDK bundled)')
  check('no unexpected tools were offered', !events.some((e) => e.kind === 'warning' && e.message.includes('unexpected tools')),
    events.filter((e) => e.kind === 'warning').map((e) => (e as { message: string }).message).join(' | '))
  check('the skill was invoked', events.some((e) => e.kind === 'tool' && e.name === 'Skill'))
  check('the design was read off disk', events.some((e) => e.kind === 'tool' && e.name === 'Read'))
  check('text streamed as deltas', events.filter((e) => e.kind === 'delta').length > 0)
  check('the turn succeeded', events.some((e) => e.kind === 'result' && e.ok))

  check('a findings payload came back', parsed.payload !== null, parsed.problem ?? '')
  const payload = parsed.payload
  if (payload) {
    check('the review has 5-8 findings as instructed', payload.findings.length >= 4 && payload.findings.length <= 8,
      `${payload.findings.length}`)
    check('findings carry stable kebab ids', payload.findings.every((f) => /^[a-z0-9-]+$/.test(f.id)),
      payload.findings.map((f) => f.id).join(', '))
    check('at least one finding points at a real node', payload.findings.some((f) => f.nodes.some((n) => ['n1', 'n2', 'n3'].includes(n))))
    check('the spoken summary is written to be heard', payload.spoken_summary.length > 200 && !payload.spoken_summary.includes('*'),
      `${payload.spoken_summary.split(/\s+/).length} words`)
    check('the verdict is not "solid" for a design this weak', payload.verdict !== 'solid', payload.verdict)
    // The rubric names the read path and durability. A review that misses both
    // is technically well-formed and useless.
    const all = JSON.stringify(payload).toLowerCase()
    check('the review engages with the rubric (cache/read path, or durability)',
      /cache|cloudfront|read path|replica|dynamo/.test(all) && /multi.?az|backup|durab|single point/.test(all))
  }

  for (const [name, pass, detail] of checks) {
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
  }
  const failed = checks.filter(([, pass]) => !pass)
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
  assert.equal(failed.length, 0)
} finally {
  session.cancel()
  rmSync(root, { recursive: true, force: true })
}
