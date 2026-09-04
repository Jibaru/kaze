/**
 * Applying one finding's fix to the diagram.
 *
 * The model proposes; the app decides and applies. That split is the same one
 * the reviewer runs under — it has read-only tools and never writes a file —
 * and it matters more here, because a patch changes the thing being graded.
 *
 * So the operation set is deliberately small and there is no `remove_node`: a
 * fix should add structure or state a property, and a suggestion that silently
 * deletes part of your design is not a fix you can review. Every reference is
 * checked against the manifest and the current diagram before anything is
 * applied, and an operation that fails validation is dropped rather than
 * guessed at, with the reason kept so the panel can say what it refused.
 */
import { getService } from './services'
import type { Diagram, DiagramEdge, DiagramNode, GroupKind, NodeProps } from './types'

export type PatchOp =
  /** State a property the reviewer said was missing. */
  | { op: 'set_props'; node: string; props: NodeProps }
  /** Add a service. `as` names it for later operations in the same patch. */
  | { op: 'add_node'; service: string; label?: string; props?: NodeProps; near?: string; as?: string }
  | { op: 'add_edge'; from: string; to: string; protocol?: string }
  | { op: 'remove_edge'; from: string; to: string }
  | { op: 'set_protocol'; from: string; to: string; protocol: string }
  /** Move a node into a boundary, or out of every boundary with `null`. */
  | { op: 'move_node'; node: string; into: string | null }
  | { op: 'add_boundary'; kind: GroupKind; label?: string; as?: string }

export interface PatchResult {
  diagram: Diagram
  applied: string[]
  rejected: Array<{ reason: string; op: PatchOp }>
}

const KNOWN_OPS = new Set([
  'set_props',
  'add_node',
  'add_edge',
  'remove_edge',
  'set_protocol',
  'move_node',
  'add_boundary',
])

/** Coerce the model's JSON into operations, dropping anything unrecognised. */
export function parsePatch(value: unknown): PatchOp[] {
  const list = Array.isArray(value)
    ? value
    : Array.isArray((value as { operations?: unknown })?.operations)
      ? ((value as { operations: unknown[] }).operations)
      : []
  return list.filter((op): op is PatchOp => {
    if (!op || typeof op !== 'object') return false
    const name = (op as { op?: unknown }).op
    return typeof name === 'string' && KNOWN_OPS.has(name)
  })
}

const nextId = (taken: Set<string>, prefix: string): string => {
  for (let i = 1; ; i++) {
    const id = `${prefix}${i}`
    if (!taken.has(id)) return id
  }
}

/** Only properties the service actually models; anything else is noise in the design. */
function allowedProps(serviceId: string, props: NodeProps): { kept: NodeProps; dropped: string[] } {
  const known = new Set((getService(serviceId)?.reviewProps ?? []).map((p) => p.key))
  const kept: NodeProps = {}
  const dropped: string[] = []
  for (const [key, value] of Object.entries(props)) {
    if (known.has(key)) kept[key] = value
    else dropped.push(key)
  }
  return { kept, dropped }
}

export function applyPatch(diagram: Diagram, ops: PatchOp[]): PatchResult {
  const nodes: DiagramNode[] = diagram.nodes.map((n) => ({ ...n, props: { ...n.props } }))
  const groups = diagram.groups.map((g) => ({ ...g }))
  const edges: DiagramEdge[] = diagram.edges.map((e) => ({ ...e }))
  const applied: string[] = []
  const rejected: PatchResult['rejected'] = []

  const ids = new Set([...nodes.map((n) => n.id), ...groups.map((g) => g.id)])
  /** `as` aliases, so one patch can add a node and then wire it up. */
  const aliases = new Map<string, string>()
  const resolve = (ref: string): string | undefined =>
    aliases.get(ref) ?? (ids.has(ref) ? ref : undefined)

  const findNode = (ref: string) => {
    const id = resolve(ref)
    return id ? nodes.find((n) => n.id === id) : undefined
  }

  for (const op of ops) {
    const reject = (reason: string) => rejected.push({ reason, op })

    switch (op.op) {
      case 'set_props': {
        const node = findNode(op.node)
        if (!node) {
          reject(`no such node: ${op.node}`)
          break
        }
        const { kept, dropped } = allowedProps(node.serviceId, op.props ?? {})
        if (Object.keys(kept).length === 0) {
          reject(`${node.serviceId} models none of: ${dropped.join(', ') || '(nothing given)'}`)
          break
        }
        node.props = { ...node.props, ...kept }
        applied.push(`${node.id}: ${Object.keys(kept).join(', ')}`)
        break
      }

      case 'add_node': {
        if (!getService(op.service)) {
          reject(`unknown service: ${op.service}`)
          break
        }
        const anchor = op.near ? findNode(op.near) : undefined
        const id = nextId(ids, 'n')
        ids.add(id)
        if (op.as) aliases.set(op.as, id)
        const { kept } = allowedProps(op.service, op.props ?? {})
        nodes.push({
          id,
          serviceId: op.service,
          label: op.label?.trim() || getService(op.service)!.name,
          props: kept,
          // Placed by the app, not by the model: coordinates are not something
          // it can reason about, and a pile of nodes at the origin is worse
          // than a predictable offset from whatever the fix was about.
          x: (anchor?.x ?? 120) + 260,
          y: (anchor?.y ?? 120) + 150,
          ...(anchor?.parentId ? { parentId: anchor.parentId } : {}),
        })
        applied.push(`+ ${op.service} (${id})`)
        break
      }

      case 'add_boundary': {
        const id = nextId(ids, op.kind === 'az' ? 'az-' : `${op.kind}-`)
        ids.add(id)
        if (op.as) aliases.set(op.as, id)
        groups.push({
          id,
          kind: op.kind,
          label: op.label?.trim() || id,
          x: 60,
          y: 60,
          width: 460,
          height: 320,
        })
        applied.push(`+ ${op.kind} (${id})`)
        break
      }

      case 'add_edge': {
        const from = resolve(op.from)
        const to = resolve(op.to)
        if (!from || !to) {
          reject(`no such node: ${!from ? op.from : op.to}`)
          break
        }
        if (from === to) {
          reject('an edge from a node to itself')
          break
        }
        if (edges.some((e) => e.from === from && e.to === to)) {
          reject(`${from} -> ${to} already exists`)
          break
        }
        edges.push({ id: `e-${from}-${to}`, from, to, ...(op.protocol ? { protocol: op.protocol } : {}) })
        applied.push(`+ ${from} -> ${to}`)
        break
      }

      case 'remove_edge': {
        const from = resolve(op.from)
        const to = resolve(op.to)
        const index = edges.findIndex((e) => e.from === from && e.to === to)
        if (index === -1) {
          reject(`no such edge: ${op.from} -> ${op.to}`)
          break
        }
        edges.splice(index, 1)
        applied.push(`- ${op.from} -> ${op.to}`)
        break
      }

      case 'set_protocol': {
        const from = resolve(op.from)
        const to = resolve(op.to)
        const edge = edges.find((e) => e.from === from && e.to === to)
        if (!edge) {
          reject(`no such edge: ${op.from} -> ${op.to}`)
          break
        }
        edge.protocol = op.protocol
        applied.push(`${op.from} -> ${op.to}: ${op.protocol}`)
        break
      }

      case 'move_node': {
        const node = findNode(op.node)
        if (!node) {
          reject(`no such node: ${op.node}`)
          break
        }
        if (op.into === null) {
          delete node.parentId
          applied.push(`${node.id} out of every boundary`)
          break
        }
        const target = op.into ? resolve(op.into) : undefined
        if (!target || !groups.some((g) => g.id === target)) {
          reject(`no such boundary: ${op.into}`)
          break
        }
        node.parentId = target
        applied.push(`${node.id} into ${target}`)
        break
      }
    }
  }

  return { diagram: { ...diagram, nodes, groups, edges }, applied, rejected }
}
