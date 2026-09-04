/**
 * Phase 4 exit criterion, mechanically: a finding you fix flips to resolved, a
 * finding merely reworded stays open, and one that comes back is a regression.
 *
 * The paraphrases below are the real risk. A model regenerates its prose every
 * review; if matching only worked on identical wording it would report a fix
 * every time the model changed its mind about phrasing.
 *
 * Run: node scripts/check.mjs scripts/check-ledger.mts
 */
import assert from 'node:assert/strict'
import { emptyLedger, reconcile, similarity, sortEntries } from '../src/shared/ledger.ts'
import type { ReviewPayload } from '../src/shared/findings.ts'

const checks: Array<[string, boolean, string?]> = []
const check = (name: string, pass: boolean, detail = '') => checks.push([name, pass, detail])

const payload = (findings: Array<Record<string, unknown>>, resolved: string[] = []): ReviewPayload => ({
  verdict: 'needs_work',
  spoken_summary: '',
  resolved,
  findings: findings.map((f) => ({
    id: 'f-x',
    severity: 'high',
    pillar: 'reliability',
    bp_id: null,
    nodes: [],
    claim: '',
    fix: '',
    ...f,
  })) as ReviewPayload['findings'],
})

// ── revision 1 ────────────────────────────────────────────────────────────
const rev1 = reconcile(emptyLedger(), payload([
  { id: 'f-db-single-az', pillar: 'reliability', nodes: ['n5'],
    claim: 'The primary datastore is single-AZ, so an AZ failure loses the write path.' },
  { id: 'f-no-cache', pillar: 'performance', nodes: ['n3', 'n5'],
    claim: 'Every redirect reads the primary database instead of a cache.' },
  { id: 'f-no-alarms', severity: 'low', pillar: 'operations', nodes: [],
    claim: 'Nothing monitors the system: no alarms are defined anywhere.' },
]), 1)

check('a first review makes everything new', rev1.entries.every((e) => e.status === 'new'), `${rev1.entries.length} entries`)
check('first-seen revision is recorded', rev1.entries.every((e) => e.firstSeenRevision === 1))

// ── revision 2: cache added, DB reworded, one genuinely new ───────────────
const rev2 = reconcile(rev1, payload([
  // Same problem, completely different words. Must NOT read as a fix.
  { id: 'f-db-single-az', pillar: 'reliability', nodes: ['n5'],
    claim: 'links-db still runs in a single availability zone with no standby, so losing that AZ takes writes down.' },
  { id: 'f-queue-no-dlq', severity: 'medium', pillar: 'reliability', nodes: ['n7'],
    claim: 'The queue has no dead-letter queue, so poison messages are retried forever.' },
], ['f-no-cache']), 2)

const byId = (id: string) => rev2.entries.find((e) => e.id === id)

check('a fixed finding flips to resolved', byId('f-no-cache')?.status === 'resolved')
check('the declared fix is recorded as declared', byId('f-no-cache')?.resolvedBy === 'declared')
check('the fix records which revision fixed it', byId('f-no-cache')?.resolvedAtRevision === 2)
check('a reworded finding stays open, not "fixed"', byId('f-db-single-az')?.status === 'open')
check('a reworded finding keeps its original first-seen revision', byId('f-db-single-az')?.firstSeenRevision === 1)
check('a reworded finding takes the new wording', byId('f-db-single-az')?.claim.includes('standby') === true)
check('a genuinely new finding is new', byId('f-queue-no-dlq')?.status === 'new')
check('a finding that simply went unraised is resolved, but marked as such',
  byId('f-no-alarms')?.status === 'resolved' && byId('f-no-alarms')?.resolvedBy === 'not-raised')

// ── revision 3: the cache is ripped out again ─────────────────────────────
const rev3 = reconcile(rev2, payload([
  { id: 'f-no-cache', pillar: 'performance', nodes: ['n3', 'n5'],
    claim: 'Redirects hit the primary database directly again; the cache is gone.' },
]), 3)

check('a resolved finding that comes back is a regression',
  rev3.entries.find((e) => e.id === 'f-no-cache')?.status === 'regressed')
check('regressions sort above everything else', sortEntries(rev3.entries)[0]?.status === 'regressed')

// ── identity is the app's, not the model's ────────────────────────────────
const renamed = reconcile(rev1, payload([
  // Same pillar, same node, same substance — but the model renamed the id.
  { id: 'f-database-availability', pillar: 'reliability', nodes: ['n5'],
    claim: 'The primary datastore is single-AZ, so an AZ failure loses the write path.' },
]), 2)
check('a renamed finding is matched on substance, not on its id',
  renamed.entries.find((e) => e.claim.includes('single-AZ'))?.id === 'f-db-single-az')
check('the renamed finding is open rather than new',
  renamed.entries.find((e) => e.id === 'f-db-single-az')?.status === 'open')

// ── the over-merge failure: two real findings must not collapse ───────────
const distinct = reconcile(rev1, payload([
  { id: 'f-a', pillar: 'reliability', nodes: ['n5'],
    claim: 'The primary datastore is single-AZ, so an AZ failure loses the write path.' },
  { id: 'f-b', pillar: 'reliability', nodes: ['n5'],
    claim: 'The primary datastore has no backup policy, so corruption is unrecoverable.' },
]), 2)
check('two findings on the same node do not collapse into one',
  distinct.entries.filter((e) => e.lastSeenRevision === 2).length === 2,
  distinct.entries.filter((e) => e.lastSeenRevision === 2).map((e) => e.id).join(', '))

// A different pillar is a different finding, however similar the words.
const otherPillar = reconcile(rev1, payload([
  { id: 'f-cost', pillar: 'cost', nodes: ['n5'],
    claim: 'The primary datastore is single-AZ, so an AZ failure loses the write path.' },
]), 2)
check('the same words under a different pillar are not merged',
  otherPillar.entries.find((e) => e.pillar === 'cost')?.status === 'new')

// A different node is a different finding.
const otherNode = reconcile(rev1, payload([
  { id: 'f-other', pillar: 'reliability', nodes: ['n9'],
    claim: 'The primary datastore is single-AZ, so an AZ failure loses the write path.' },
]), 2)
check('the same words about a different node are not merged',
  otherNode.entries.find((e) => e.nodes.includes('n9'))?.status === 'new')

// ── similarity behaves ────────────────────────────────────────────────────
check('similarity ignores stopwords and punctuation',
  similarity('The database is single-AZ.', 'database single-AZ') > 0.8)
check('similarity separates unrelated claims',
  similarity('The database is single-AZ with no standby.', 'The queue has no dead-letter queue.') < 0.15)

for (const [name, pass, detail] of checks) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}
const failed = checks.filter(([, pass]) => !pass)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
assert.equal(failed.length, 0)
