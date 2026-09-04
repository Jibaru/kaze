/**
 * The product, end to end: review a weak design, fix one specific thing, review
 * again, and watch that finding flip to resolved while the untouched ones stay
 * open. If this passes, the loop the whole app exists for actually closes.
 *
 * Two live reviews. Run: node scripts/check.mjs scripts/check-loop.mts
 */
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { WorkspaceStore } from '../src/main/workspace-store.ts'
import { SessionManager } from '../src/main/session-manager.ts'
import { parseReview } from '../src/shared/findings.ts'
import { reconcile, type Ledger } from '../src/shared/ledger.ts'
import type { Diagram } from '../src/shared/types.ts'

const checks: Array<[string, boolean, string?]> = []
const check = (name: string, pass: boolean, detail = '') => checks.push([name, pass, detail])

const root = mkdtempSync(join(tmpdir(), 'kaze-loop-'))
const template = resolve('workspace')
const store = new WorkspaceStore(root)

cpSync(join(template, 'CLAUDE.md'), join(root, 'CLAUDE.md'))
cpSync(join(template, '.claude'), join(root, '.claude'), { recursive: true })
cpSync(join(template, 'scenarios'), join(root, 'scenarios'), { recursive: true })

/** Weak on purpose, and weakest at the database: single-AZ, no backup. */
const revision1: Diagram = {
  version: 1,
  scenarioId: 'url-shortener',
  groups: [
    { id: 'vpc', kind: 'vpc', label: 'main', x: 0, y: 0, width: 900, height: 500 },
    { id: 'az-a', kind: 'az', label: 'eu-west-1a', x: 0, y: 0, width: 420, height: 420, parentId: 'vpc' },
  ],
  nodes: [
    { id: 'n1', serviceId: 'CloudFront', label: 'cdn', props: { tls: true, cache_policy: '24h, invalidate on delete' }, x: 0, y: 0 },
    { id: 'n2', serviceId: 'ALB', label: 'edge-lb', props: { tls: true }, x: 0, y: 0, parentId: 'vpc' },
    { id: 'n3', serviceId: 'ECS', label: 'shortener-api', props: { multi_az: true, autoscaling: '4-40 on RPS' }, x: 0, y: 0, parentId: 'az-a' },
    { id: 'n4', serviceId: 'ElastiCache', label: 'code-cache', props: { engine: 'redis', multi_az: true, eviction: 'allkeys-lru' }, x: 0, y: 0, parentId: 'az-a' },
    { id: 'n5', serviceId: 'RDS', label: 'links-db', props: { engine: 'postgres' }, x: 0, y: 0, parentId: 'az-a' },
    { id: 'n6', serviceId: 'SQS', label: 'click-events', props: { dlq: true }, x: 0, y: 0, parentId: 'az-a' },
    { id: 'n7', serviceId: 'Lambda', label: 'click-aggregator', props: { concurrency: 'reserved 50' }, x: 0, y: 0 },
    { id: 'n8', serviceId: 'CloudWatch', label: 'alarms', props: { alarms: 'p99 > 100ms for 5m' }, x: 0, y: 0 },
  ],
  edges: [
    { id: 'e1', from: 'n1', to: 'n2', protocol: 'HTTPS' },
    { id: 'e2', from: 'n2', to: 'n3', protocol: 'HTTP' },
    { id: 'e3', from: 'n3', to: 'n4', protocol: 'RESP' },
    { id: 'e4', from: 'n3', to: 'n5', protocol: 'TCP/5432' },
    { id: 'e5', from: 'n3', to: 'n6', protocol: 'HTTPS' },
    { id: 'e6', from: 'n6', to: 'n7', protocol: 'event' },
    { id: 'e7', from: 'n3', to: 'n8', protocol: 'metrics' },
  ],
}

/** The ONE change: the database becomes durable. Nothing else moves. */
const revision2: Diagram = {
  ...revision1,
  nodes: revision1.nodes.map((n) =>
    n.id === 'n5'
      ? { ...n, props: { engine: 'postgres', multi_az: true, backup: 'PITR, 35 days', read_replicas: '2' } }
      : n,
  ),
}

const session = new SessionManager({ cwd: store.attemptDir('default'), emit: () => {}, useKnowledgeServer: false })

async function review(diagram: Diagram, ledger: Ledger | null): Promise<Ledger> {
  const snapshot = await store.snapshotRevision(diagram, 'default')
  const text = await session.send(
    `Use the kaze-review skill. Review revision ${snapshot.revision} of design.md against scenarios/url-shortener.md.`,
    'review',
  )
  const parsed = parseReview(text)
  assert.ok(parsed.payload, `revision ${snapshot.revision} produced no findings block: ${parsed.problem}`)
  const next = reconcile(ledger, parsed.payload, snapshot.revision)
  await store.saveLedger(next, 'default')
  return next
}

const describe = (l: Ledger) =>
  l.entries.map((e) => `${e.status.padEnd(9)} ${e.id} [${e.nodes.join(',') || '-'}]`).join('\n')

try {
  console.log('--- revision 1 ---')
  const first = await review(revision1, null)
  console.log(describe(first), '\n')

  const durability = first.entries.find(
    (e) => e.nodes.includes('n5') && /multi.?az|availability zone|backup|durab|single|replica/i.test(e.claim),
  )
  check('the first review flags the single-AZ database with no backup', durability !== undefined,
    durability?.id ?? first.entries.map((e) => e.id).join(', '))
  check('everything in the first review is new', first.entries.every((e) => e.status === 'new'))
  const openBefore = first.entries.filter((e) => e.status !== 'resolved').length

  console.log('--- revision 2 (multi-AZ + PITR + replicas on n5, nothing else changed) ---')
  const second = await review(revision2, first)
  console.log(describe(second), '\n')

  const after = durability ? second.entries.find((e) => e.id === durability.id) : undefined
  check('the fixed finding flips to resolved', after?.status === 'resolved', after?.status ?? 'entry vanished')
  check('the fix is attributed to revision 2', after?.resolvedAtRevision === 2, String(after?.resolvedAtRevision))
  check('the ledger remembers the finding rather than deleting it', after !== undefined)

  // The real risk is a review that rewords everything and reads as "all fixed".
  const stillOpen = second.entries.filter((e) => e.status === 'open').length
  check('untouched findings stay open rather than all resolving at once', stillOpen > 0,
    `${stillOpen} of ${openBefore} still open`)
  check('nothing regressed', !second.entries.some((e) => e.status === 'regressed'))

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
