/**
 * Phase 2 exit criterion: the app finds the omissions itself, before the model
 * ever sees the design — and stops reporting them once they are fixed.
 *
 * Run: node --experimental-strip-types scripts/check-adl.mts [--print]
 */
import assert from 'node:assert/strict'
import { BACKUP_PROPS, computeGaps, diffDiagrams, MULTI_AZ_PROPS, SCALING_PROPS, serialize } from '../src/shared/adl.ts'
import { SERVICES } from '../src/shared/services.ts'
import type { Diagram } from '../src/shared/types.ts'

const checks: Array<[string, boolean, string?]> = []
const check = (name: string, pass: boolean, detail = '') => checks.push([name, pass, detail])

/** A design with one deliberate omission of every kind the rules know about. */
const flawed: Diagram = {
  version: 1,
  scenarioId: 'url-shortener',
  groups: [
    { id: 'vpc', kind: 'vpc', label: 'main', x: 0, y: 0, width: 900, height: 520 },
    { id: 'az-a', kind: 'az', label: 'eu-west-1a', x: 0, y: 0, width: 420, height: 420, parentId: 'vpc' },
    { id: 'az-b', kind: 'az', label: 'eu-west-1b', x: 0, y: 0, width: 420, height: 420, parentId: 'vpc' },
    { id: 'subnet', kind: 'subnet', label: 'unused', x: 0, y: 0, width: 200, height: 140, parentId: 'vpc' },
  ],
  nodes: [
    { id: 'a1', serviceId: 'Actor', label: 'lectores', props: { channel: 'web' }, x: 0, y: 0, parentId: 'vpc' },
    { id: 'n0', serviceId: 'Route53', label: 'dns', props: { routing_policy: 'latency' }, x: 0, y: 0 },
    { id: 'n1', serviceId: 'CloudFront', label: 'cdn', props: {}, x: 0, y: 0 },
    { id: 'n2', serviceId: 'ALB', label: 'edge-lb', props: {}, x: 0, y: 0, parentId: 'vpc' },
    { id: 'n3', serviceId: 'ECS', label: 'shortener-api', props: {}, x: 0, y: 0, parentId: 'az-a' },
    { id: 'n4', serviceId: 'RDS', label: 'links-db', props: { engine: 'postgres' }, x: 0, y: 0, parentId: 'az-a' },
    { id: 'n5', serviceId: 'ElastiCache', label: 'hot-links', props: { engine: 'redis' }, x: 0, y: 0, parentId: 'az-b' },
    { id: 'n6', serviceId: 'S3', label: 'raw-clicks', props: {}, x: 0, y: 0 },
  ],
  edges: [
    { id: 'ea', from: 'a1', to: 'n0', protocol: 'HTTPS' },
    { id: 'e0', from: 'n0', to: 'n1', protocol: 'DNS' },
    { id: 'e1', from: 'n1', to: 'n2', protocol: 'HTTPS' },
    { id: 'e2', from: 'n2', to: 'n3' },
    { id: 'e3', from: 'n3', to: 'n4', protocol: 'TCP/5432' },
  ],
}

const gaps = computeGaps(flawed)
const has = (rule: string, ref?: string) =>
  gaps.some((g) => g.rule === rule && (ref === undefined || g.refs.includes(ref)))

check('single-AZ database is flagged', has('single_az', 'n4'))
check('database with no backup policy is flagged', has('no_backup', 'n4'))
check('untyped edge is flagged', has('untyped_edge', 'e2'))
check('unconnected node is flagged', has('unconnected_node', 'n5'))
check('compute with no scaling policy is flagged', has('no_scaling_policy', 'n3'))
check('internet-facing node with no TLS is flagged', has('untls_entrypoint', 'n2'))
check('stateful node outside every boundary is flagged', has('unplaced', 'n6'))
check('empty boundary is flagged', has('empty_boundary', 'subnet'))
check('a design with no monitoring is flagged', has('no_observability'))
// An actor drawn inside a VPC says the user runs in your network.
check('an actor inside a boundary is flagged', has('actor_inside_boundary', 'a1'))

// Route 53 is an entry point, but TLS is not a question you can answer about
// it. A rule that fires where the design cannot respond is noise.
check('TLS rule stays silent on a service that does not model TLS', !has('untls_entrypoint', 'n0'))

// The invariant that would have caught the ECS bug at authoring time: every
// flag that demands a property must be answerable from the inspector.
const unclosable: string[] = []
for (const spec of SERVICES) {
  const keys = (spec.reviewProps ?? []).map((p) => p.key)
  const demands: Array<[boolean | undefined, string[], string]> = [
    [spec.flags?.needsMultiAz, MULTI_AZ_PROPS, 'needsMultiAz'],
    [spec.flags?.needsBackup, BACKUP_PROPS, 'needsBackup'],
    [spec.flags?.needsScalingPolicy, SCALING_PROPS, 'needsScalingPolicy'],
  ]
  for (const [flag, satisfying, name] of demands) {
    if (flag && !keys.some((k) => satisfying.includes(k))) unclosable.push(`${spec.id}.${name}`)
  }
}
check('every gap the manifest demands is closable from the inspector', unclosable.length === 0, unclosable.join(', '))

// ── now fix everything, and check the gaps actually go away ────────────────
// Patches are keyed by id rather than by array index: a fixture that depends on
// position breaks the moment a node is added at the front, and the failure looks
// like a rule regression rather than a test that moved.
const FIXES: Record<string, Partial<Diagram['nodes'][number]>> = {
  a1: { parentId: undefined },
  n1: { props: { tls: true } },
  n2: { props: { tls: true } },
  n3: { props: { multi_az: true, autoscaling: 'target 60% CPU, 2-20' } },
  n4: { props: { engine: 'postgres', multi_az: true, backup: 'PITR, 7 days' } },
  n5: { props: { engine: 'redis', multi_az: true } },
  n6: { props: { versioning: true }, parentId: 'vpc' },
}

const fixed: Diagram = {
  ...flawed,
  groups: flawed.groups.filter((g) => g.id !== 'subnet'),
  nodes: [
    ...flawed.nodes.map((n) => ({ ...n, ...(FIXES[n.id] ?? {}) })),
    { id: 'n7', serviceId: 'CloudWatch', label: 'alarms', props: { alarms: 'p99 > 200ms for 5m' }, x: 0, y: 0 },
  ],
  edges: [
    { id: 'ea', from: 'a1', to: 'n0', protocol: 'HTTPS' },
    { id: 'e0', from: 'n0', to: 'n1', protocol: 'DNS' },
    { id: 'e1', from: 'n1', to: 'n2', protocol: 'HTTPS' },
    { id: 'e2', from: 'n2', to: 'n3', protocol: 'HTTP' },
    { id: 'e3', from: 'n3', to: 'n4', protocol: 'TCP/5432' },
    { id: 'e4', from: 'n3', to: 'n5', protocol: 'RESP' },
    { id: 'e5', from: 'n3', to: 'n6', protocol: 'HTTPS' },
    { id: 'e6', from: 'n3', to: 'n7', protocol: 'metrics' },
  ],
}

const fixedGaps = computeGaps(fixed)
const rules = fixedGaps.map((g) => g.rule).join(', ')

check('fixing multi-AZ clears the finding', !fixedGaps.some((g) => g.rule === 'single_az'))
check('stating a backup clears the finding', !fixedGaps.some((g) => g.rule === 'no_backup'))
check('S3 versioning counts as a backup story', !fixedGaps.some((g) => g.rule === 'no_backup' && g.refs.includes('n6')))
check('typing the edge clears the finding', !fixedGaps.some((g) => g.rule === 'untyped_edge'))
check('connecting the cache clears the finding', !fixedGaps.some((g) => g.rule === 'unconnected_node'))
check('adding CloudWatch clears the observability finding', !fixedGaps.some((g) => g.rule === 'no_observability'))
check('moving the actor out of the VPC clears the finding',
  !fixedGaps.some((g) => g.rule === 'actor_inside_boundary'))
// Custom nodes carry no flags, so no rule may invent a requirement for them.
check('a Custom node raises nothing beyond being unconnected',
  computeGaps({ ...fixed, nodes: [...fixed.nodes, { id: 'c1', serviceId: 'Custom', label: 'Kafka', props: { kind: 'Kafka' }, x: 0, y: 0 }] })
    .filter((g) => g.refs.includes('c1'))
    .every((g) => g.rule === 'unconnected_node'))
check('a corrected design has no gaps at all', fixedGaps.length === 0, rules || 'none')

// ── diff ──────────────────────────────────────────────────────────────────
const diff = diffDiagrams(flawed, fixed)
check('diff sees the added node', diff.addedNodes.some((n) => n.startsWith('n7 ')))
check('diff sees the added edges', diff.addedEdges.includes('n3 -> n5'))
check('diff sees a flipped prop', diff.changedProps.includes('n4.multi_az: unset -> true'))
// A prop that was already set and did not change must not appear as a change.
check('diff ignores what did not move', !diff.changedProps.some((c) => c.startsWith('n4.engine')),
  diff.changedProps.filter((c) => c.startsWith('n4.engine')).join(', '))

// ── serialization ─────────────────────────────────────────────────────────
const text = serialize(flawed, { revision: 1, diff: diffDiagrams(null, flawed) })
check('serialized design names its scenario', text.startsWith('scenario: url-shortener'))
check('serialized design carries containment', text.includes('{ id: n4, service: RDS, label: links-db, in: az-a'))
check('serialized design carries props', text.includes('props: { engine: postgres }'))
check('serialized design carries an untyped edge as untyped', text.includes('{ from: n2, to: n3 }'))
check('serialized design carries the gaps section', text.includes('gaps:') && text.includes('single_az'))
check('a clean design says so explicitly', serialize(fixed).includes('gaps: []'))

// Presentation must not leak into the document the reviewer reads: whether a
// connection is drawn curved or square-cornered is not something to have an
// opinion about, and putting it in the design would invite one.
const styled = serialize({ ...flawed, edgeStyle: 'smoothstep', background: 'grid' })
check('the serialized design carries no view settings',
  !styled.includes('edgeStyle') && !styled.includes('smoothstep') && !styled.includes('background'))

if (process.argv.includes('--print')) {
  console.log('\n--- serialize(flawed) ---\n')
  console.log(text)
  console.log('--- serialize(fixed) ---\n')
  console.log(serialize(fixed, { revision: 2, diff }))
}

for (const [name, pass, detail] of checks) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

const failed = checks.filter(([, pass]) => !pass)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
assert.equal(failed.length, 0)
