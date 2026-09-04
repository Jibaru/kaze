/**
 * Applying a fix takes model output and changes the thing being graded, so the
 * validation is the feature. Every check here is a way a proposed patch could
 * quietly damage a design rather than improve it.
 *
 * Run: node scripts/check.mjs scripts/check-patch.mts
 */
import assert from 'node:assert/strict'
import { applyPatch, parsePatch, type PatchOp } from '../src/shared/patch.ts'
import type { Diagram } from '../src/shared/types.ts'

const checks: Array<[string, boolean, string?]> = []
const check = (name: string, pass: boolean, detail = '') => checks.push([name, pass, detail])

const base: Diagram = {
  version: 1,
  scenarioId: 'url-shortener',
  groups: [{ id: 'az-a', kind: 'az', label: 'eu-west-1a', x: 0, y: 0, width: 400, height: 400 }],
  nodes: [
    { id: 'n1', serviceId: 'ECS', label: 'api', props: {}, x: 100, y: 100, parentId: 'az-a' },
    { id: 'n2', serviceId: 'RDS', label: 'db', props: { engine: 'postgres' }, x: 100, y: 300, parentId: 'az-a' },
  ],
  edges: [{ id: 'e-n1-n2', from: 'n1', to: 'n2' }],
}

const run = (ops: PatchOp[]) => applyPatch(base, ops)

// ── the ordinary case ─────────────────────────────────────────────────────
const props = run([{ op: 'set_props', node: 'n2', props: { multi_az: true, backup: 'PITR, 7 days' } }])
check('states a property the finding asked for',
  props.diagram.nodes[1]!.props.multi_az === true && props.diagram.nodes[1]!.props.backup === 'PITR, 7 days')
check('leaves the rest of the node alone', props.diagram.nodes[1]!.props.engine === 'postgres')
check('the original diagram is untouched', base.nodes[1]!.props.multi_az === undefined)

// A patch can add something and then wire it up, via `as`.
const added = run([
  { op: 'add_node', service: 'ElastiCache', label: 'cache', near: 'n1', as: 'cache' },
  { op: 'add_edge', from: 'n1', to: 'cache', protocol: 'RESP' },
])
const cache = added.diagram.nodes.find((n) => n.serviceId === 'ElastiCache')
check('adds a service', cache !== undefined)
check('an alias added in the patch can be wired up',
  added.diagram.edges.some((e) => e.from === 'n1' && e.to === cache?.id && e.protocol === 'RESP'))
check('the app places the new node, near what the fix was about',
  cache?.x === 360 && cache?.y === 250, `${cache?.x},${cache?.y}`)
check('a node added beside one inside a boundary joins that boundary', cache?.parentId === 'az-a')

check('types an existing connection',
  run([{ op: 'set_protocol', from: 'n1', to: 'n2', protocol: 'TCP/5432' }]).diagram.edges[0]!.protocol === 'TCP/5432')
check('moves a node out of every boundary',
  run([{ op: 'move_node', node: 'n1', into: null }]).diagram.nodes[0]!.parentId === undefined)

// ── what it must refuse ───────────────────────────────────────────────────
const unknownService = run([{ op: 'add_node', service: 'Kubernetes' }])
check('refuses a service the manifest does not have',
  unknownService.applied.length === 0 && unknownService.rejected[0]?.reason.includes('unknown service'))

const unknownNode = run([{ op: 'set_props', node: 'n99', props: { multi_az: true } }])
check('refuses a node that does not exist', unknownNode.rejected[0]?.reason.includes('no such node'))

// A property the service does not model would be invented vocabulary in the
// serialized design, which the reviewer would then argue with.
const strayProp = run([{ op: 'set_props', node: 'n1', props: { partition_key: 'short_code' } }])
check('refuses a property the service does not model',
  strayProp.applied.length === 0 && strayProp.rejected[0]!.reason.includes('models none of'))

const mixed = run([{ op: 'set_props', node: 'n2', props: { multi_az: true, partition_key: 'x' } }])
check('keeps the modelled half of a mixed set',
  mixed.diagram.nodes[1]!.props.multi_az === true && mixed.diagram.nodes[1]!.props.partition_key === undefined)

check('refuses a duplicate connection',
  run([{ op: 'add_edge', from: 'n1', to: 'n2' }]).rejected[0]?.reason.includes('already exists'))
check('refuses an edge from a node to itself',
  run([{ op: 'add_edge', from: 'n1', to: 'n1' }]).rejected[0]?.reason.includes('itself'))
check('refuses to remove an edge that is not there',
  run([{ op: 'remove_edge', from: 'n2', to: 'n1' }]).rejected[0]?.reason.includes('no such edge'))
check('refuses a boundary that does not exist',
  run([{ op: 'move_node', node: 'n1', into: 'az-z' }]).rejected[0]?.reason.includes('no such boundary'))

// A patch is not a licence to restructure: nothing here can delete a node.
const destructive = parsePatch([{ op: 'remove_node', node: 'n1' }, { op: 'set_props', node: 'n1', props: {} }])
check('there is no operation that deletes a node', destructive.every((o) => o.op !== ('remove_node' as string)),
  destructive.map((o) => o.op).join(', '))

// ── parsing what a model actually returns ────────────────────────────────
check('accepts a bare array', parsePatch([{ op: 'set_props', node: 'n1', props: {} }]).length === 1)
check('accepts an object wrapping `operations`',
  parsePatch({ operations: [{ op: 'add_edge', from: 'a', to: 'b' }] }).length === 1)
check('drops entries that are not operations', parsePatch([{ op: 'nonsense' }, null, 'x', 7]).length === 0)
check('survives a reply with no patch at all', parsePatch(null).length === 0 && parsePatch('nope').length === 0)

// Good ops still apply when a bad one sits beside them.
const partial = run([
  { op: 'set_props', node: 'n2', props: { multi_az: true } },
  { op: 'add_node', service: 'NotAThing' },
])
check('one bad operation does not discard the good ones',
  partial.applied.length === 1 && partial.rejected.length === 1)

for (const [name, pass, detail] of checks) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}
const failed = checks.filter(([, pass]) => !pass)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
assert.equal(failed.length, 0)
