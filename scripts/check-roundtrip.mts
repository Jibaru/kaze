/**
 * Phase 1 exit criterion, mechanically: a ten-node design with boundaries,
 * nested children, configured props and edges survives
 * flow -> save format -> flow -> save format unchanged.
 *
 * Run: node --experimental-strip-types scripts/check-roundtrip.mts
 */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { flipEdges, fromFlow, toFlow, viewOf, type KazeEdge, type KazeNode } from '../src/renderer/src/diagram-model.ts'
import { getService, SERVICES } from '../src/shared/services.ts'
import type { Diagram } from '../src/shared/types.ts'

const nodes: KazeNode[] = [
  { id: 'vpc', type: 'group', position: { x: 40, y: 40 }, data: { kind: 'vpc', label: 'main' }, style: { width: 900, height: 520 } },
  { id: 'az-a', type: 'group', position: { x: 20, y: 60 }, data: { kind: 'az', label: 'eu-west-1a' }, style: { width: 420, height: 420 }, parentId: 'vpc', extent: 'parent' },
  { id: 'az-b', type: 'group', position: { x: 460, y: 60 }, data: { kind: 'az', label: 'eu-west-1b' }, style: { width: 420, height: 420 }, parentId: 'vpc', extent: 'parent' },
  { id: 'n1', type: 'service', position: { x: 60, y: -140 }, data: { serviceId: 'Route53', label: 'dns', props: { routing_policy: 'latency' } } },
  { id: 'n2', type: 'service', position: { x: 320, y: -140 }, data: { serviceId: 'CloudFront', label: 'cdn', props: { tls: true, cache_policy: '60s on /r/*' } } },
  { id: 'n3', type: 'service', position: { x: 200, y: 8 }, data: { serviceId: 'ALB', label: 'edge-lb', props: { tls: true } }, parentId: 'vpc', extent: 'parent' },
  { id: 'n4', type: 'service', position: { x: 40, y: 60 }, data: { serviceId: 'ECS', label: 'shortener-api', props: { launch_type: 'fargate' } }, parentId: 'az-a', extent: 'parent' },
  { id: 'n5', type: 'service', position: { x: 40, y: 200 }, data: { serviceId: 'RDS', label: 'links-db', props: { engine: 'postgres', multi_az: false } }, parentId: 'az-a', extent: 'parent' },
  { id: 'n6', type: 'service', position: { x: 40, y: 60 }, data: { serviceId: 'ElastiCache', label: 'hot-links', props: { engine: 'redis' } }, parentId: 'az-b', extent: 'parent' },
  { id: 'n7', type: 'service', position: { x: 40, y: 200 }, data: { serviceId: 'SQS', label: 'click-events', props: { dlq: true } }, parentId: 'az-b', extent: 'parent' },
  { id: 'n8', type: 'service', position: { x: 120, y: 640 }, data: { serviceId: 'Lambda', label: 'click-aggregator', props: {} } },
  { id: 'n9', type: 'service', position: { x: 400, y: 640 }, data: { serviceId: 'DynamoDB', label: 'click-counts', props: { partition_key: 'short_code', capacity: 'on-demand' } } },
  { id: 'n10', type: 'service', position: { x: 690, y: 640 }, data: { serviceId: 'S3', label: 'raw-clicks', props: { versioning: true, lifecycle: 'IA at 30d' } } },
]

const edges: KazeEdge[] = [
  { id: 'e-n1-n2', source: 'n1', target: 'n2', data: { protocol: 'DNS' }, sourceHandle: 'bottom', targetHandle: 'top' },
  { id: 'e-n2-n3', source: 'n2', target: 'n3', data: { protocol: 'HTTPS' } },
  { id: 'e-n3-n4', source: 'n3', target: 'n4', data: {} },
  { id: 'e-n4-n5', source: 'n4', target: 'n5', data: { protocol: 'TCP/5432' } },
  { id: 'e-n4-n6', source: 'n4', target: 'n6', data: { protocol: 'RESP' } },
  { id: 'e-n4-n7', source: 'n4', target: 'n7', data: {} },
  { id: 'e-n7-n8', source: 'n7', target: 'n8', data: {} },
  { id: 'e-n8-n9', source: 'n8', target: 'n9', data: {} },
  { id: 'e-n8-n10', source: 'n8', target: 'n10', data: {} },
]

const checks: Array<[string, boolean, string?]> = []
const check = (name: string, pass: boolean, detail = '') => checks.push([name, pass, detail])

const VIEW = { edgeStyle: 'smoothstep', background: 'grid' } as const
const saved: Diagram = fromFlow(nodes, edges, 'url-shortener', VIEW)

check('10 services survive the split', saved.nodes.length === 10, `${saved.nodes.length}`)
check('3 boundaries survive the split', saved.groups.length === 3, `${saved.groups.length}`)
check('9 edges survive the split', saved.edges.length === 9, `${saved.edges.length}`)
check('containment is preserved', saved.nodes.find((n) => n.id === 'n5')?.parentId === 'az-a')
check('nested boundaries are preserved', saved.groups.find((g) => g.id === 'az-a')?.parentId === 'vpc')
check('group size is preserved', saved.groups.find((g) => g.id === 'vpc')?.width === 900)
check('props are preserved', saved.nodes.find((n) => n.id === 'n9')?.props.partition_key === 'short_code')
check('protocols are preserved', saved.edges.find((e) => e.id === 'e-n4-n5')?.protocol === 'TCP/5432')
// Which side a line leaves and arrives on is presentation, kept so the drawing
// survives a reload.
const handled = saved.edges.find((e) => e.id === 'e-n1-n2')
check('the sides a connection attaches to are preserved',
  handled?.fromHandle === 'bottom' && handled?.toHandle === 'top',
  `${handled?.fromHandle} -> ${handled?.toHandle}`)
check('an edge with no chosen sides stays that way',
  saved.edges.find((e) => e.id === 'e-n3-n4')?.fromHandle === undefined)
check('an untyped edge stays untyped', saved.edges.find((e) => e.id === 'e-n3-n4')?.protocol === undefined)

// The actual round trip: reload what we saved, save it again, compare.
const reloaded = toFlow(saved)
const resaved = fromFlow(reloaded.nodes, reloaded.edges, 'url-shortener', viewOf(saved))
check('round trip is lossless', JSON.stringify(saved) === JSON.stringify(resaved))

// View settings ride along with the diagram so the canvas looks the same when
// you come back, but they are presentation and must never reach the reviewer.
check('the line style survives the round trip', resaved.edgeStyle === 'smoothstep', String(resaved.edgeStyle))
check('the background survives the round trip', resaved.background === 'grid', String(resaved.background))
check('every edge is drawn in the chosen style', reloaded.edges.every((e) => e.type === 'smoothstep'))
check('a diagram with no view settings falls back to the defaults',
  viewOf({ ...saved, edgeStyle: undefined, background: undefined }).edgeStyle === 'bezier')

// A parent must precede its children or React Flow paints children detached.
const order = reloaded.nodes.map((n) => n.id)
const parentsFirst = reloaded.nodes.every(
  (n) => !n.parentId || order.indexOf(n.parentId) < order.indexOf(n.id),
)
check('parents are ordered before their children', parentsFirst)

// ── reversing a connection ────────────────────────────────────────────────
// Direction is meaningful — `from` initiates — and it is already what the
// review argues about, so getting one backwards has to be fixable.
const flipped = flipEdges(edges, new Set(['e-n1-n2']))
const before = edges.find((e) => e.id === 'e-n1-n2')!
const after = flipped.find((e) => e.id === 'e-n1-n2')!
check('flipping swaps the ends', after.source === before.target && after.target === before.source,
  `${after.source} -> ${after.target}`)
check('flipping swaps the sides too, or the line crosses back over the node',
  after.sourceHandle === before.targetHandle && after.targetHandle === before.sourceHandle,
  `${after.sourceHandle} -> ${after.targetHandle}`)
check('flipping keeps the id: it is the same connection', after.id === before.id)
check('flipping leaves every other connection alone',
  flipped.filter((e) => e.id !== 'e-n1-n2').every((e, i) => e === edges.filter((x) => x.id !== 'e-n1-n2')[i]))
check('flipping twice is the original', (() => {
  const back = flipEdges(flipped, new Set(['e-n1-n2'])).find((e) => e.id === 'e-n1-n2')!
  return back.source === before.source && back.sourceHandle === before.sourceHandle
})())

// Every serviceId in a design must resolve, or the canvas renders a blank box.
check('every service id resolves in the manifest', saved.nodes.every((n) => Boolean(getService(n.serviceId))))
check('manifest ids are unique', new Set(SERVICES.map((s) => s.id)).size === SERVICES.length, `${SERVICES.length} services`)

for (const [name, pass, detail] of checks) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

// Seed the app's workspace so a launch shows this design rather than a blank canvas.
const seed = process.argv.includes('--seed-to')
  ? process.argv[process.argv.indexOf('--seed-to') + 1]
  : null
if (seed) {
  mkdirSync(dirname(seed), { recursive: true })
  writeFileSync(seed, JSON.stringify(saved, null, 2), 'utf-8')
  console.log(`\nseeded ${seed}`)
}

const failed = checks.filter(([, pass]) => !pass)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
assert.equal(failed.length, 0)
