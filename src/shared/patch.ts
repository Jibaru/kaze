/**
 * Applying one finding's fix to the diagram.
 *
 * The model proposes; the app decides and applies. That split is the same one
 * the reviewer runs under — it has read-only tools and never writes a file —
 * and it matters more here, because a patch changes the thing being graded.
 *
 * So the operation set is deliberately small, and `remove_node` is off by
 * default: a *fix* should add structure or state a property, and a suggestion
 * that silently deletes part of your design is not a fix you can review.
 * Conversation mode turns it on, because there the model is drawing what you
 * just said and "quita el balanceador" has to mean something. Every reference is
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
  /** Only where the caller asks for it — see `ParseOptions`. */
  | { op: 'remove_node'; node: string }
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

export interface ParseOptions {
  /**
   * Let the model take a node out. False everywhere except conversation mode,
   * where the diagram is being built by the conversation rather than by you,
   * and refusing to undo something it drew a minute ago would be absurd.
   */
  allowRemoveNode?: boolean
}

/** Coerce the model's JSON into operations, dropping anything unrecognised. */
export function parsePatch(value: unknown, options: ParseOptions = {}): PatchOp[] {
  const list = Array.isArray(value)
    ? value
    : Array.isArray((value as { operations?: unknown })?.operations)
      ? ((value as { operations: unknown[] }).operations)
      : []
  return list.filter((op): op is PatchOp => {
    if (!op || typeof op !== 'object') return false
    const name = (op as { op?: unknown }).op
    if (typeof name !== 'string') return false
    if (name === 'remove_node') return options.allowRemoveNode === true
    return KNOWN_OPS.has(name)
  })
}

/**
 * Where a new node goes.
 *
 * The old rule — anchor plus a fixed offset — was fine when a patch added one
 * box to a diagram you had laid out yourself. Conversation mode adds several a
 * minute to a canvas nobody has arranged, and a fixed offset piles them on top
 * of each other. So: start beside the anchor (or at the next grid slot when
 * there is none) and step down until the space is actually free.
 *
 * Still the app's decision, not the model's. Coordinates are not something it
 * can reason about, and asking would only spend a round trip on a worse answer.
 */
// Wide enough that the protocol chip on a connection fits in the gap between
// two boxes rather than being squeezed onto the line.
const CELL = { x: 340, y: 170 }
const CLEAR = { x: 280, y: 110 }

function placeNode(
  taken: Array<{ x: number; y: number }>,
  anchor: { x: number; y: number } | undefined,
  count: number,
): { x: number; y: number } {
  let x = anchor ? anchor.x + CELL.x : 120 + (count % 4) * CELL.x
  let y = anchor ? anchor.y : 120 + Math.floor(count / 4) * CELL.y
  // Bounded: a diagram dense enough to exhaust this is past the point where
  // another overlap is the problem.
  for (let i = 0; i < 40; i++) {
    if (!taken.some((n) => Math.abs(n.x - x) < CLEAR.x && Math.abs(n.y - y) < CLEAR.y)) break
    y += CELL.y
    if (i === 19) {
      x += CELL.x
      y = anchor ? anchor.y : 120
    }
  }
  return { x, y }
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

export interface ApplyOptions {
  /**
   * Refuse a node that is already on the canvas, naming the one that is there.
   *
   * On for conversation mode, where the model is drawing from memory across
   * turns and a missed reference used to come back as a second copy of
   * everything. The refusal is the useful half: it is handed to the next turn,
   * so "already on the canvas as n4" teaches the id that guessing did not.
   *
   * Off for an autofix, where a patch is one considered change to a design you
   * arranged, and a second Lambda beside the first may well be the point.
   */
  refuseDuplicates?: boolean
}

/** Same service, same name, is a re-draw and not a second instance. */
const sameThing = (a: { serviceId: string; label: string }, service: string, label?: string): boolean =>
  a.serviceId === service && a.label.trim().toLowerCase() === (label ?? '').trim().toLowerCase()

export function applyPatch(
  diagram: Diagram,
  ops: PatchOp[],
  options: ApplyOptions = {},
): PatchResult {
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
        if (options.refuseDuplicates) {
          const label = op.label?.trim() || getService(op.service)!.name
          const existing = nodes.find((n) => sameThing(n, op.service, label))
          if (existing) {
            // Named, not just refused: this reason is read by the next turn.
            reject(`${op.service} "${label}" is already on the canvas as ${existing.id}`)
            // The alias still resolves, so the rest of the reply wires up to
            // the node that is actually there instead of falling apart.
            if (op.as) aliases.set(op.as, existing.id)
            break
          }
        }
        const anchor = op.near ? findNode(op.near) : undefined
        const id = nextId(ids, 'n')
        ids.add(id)
        if (op.as) aliases.set(op.as, id)
        const { kept } = allowedProps(op.service, op.props ?? {})
        const at = placeNode(nodes, anchor, nodes.length)
        nodes.push({
          id,
          serviceId: op.service,
          label: op.label?.trim() || getService(op.service)!.name,
          props: kept,
          x: at.x,
          y: at.y,
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

      case 'remove_node': {
        const node = findNode(op.node)
        if (!node) {
          reject(`no such node: ${op.node}`)
          break
        }
        nodes.splice(nodes.indexOf(node), 1)
        ids.delete(node.id)
        // Its connections go with it, or the design keeps lines to a box that
        // is not there and every later gap is about the wreckage.
        const orphaned = edges.filter((e) => e.from === node.id || e.to === node.id).length
        for (let i = edges.length - 1; i >= 0; i--) {
          if (edges[i]!.from === node.id || edges[i]!.to === node.id) edges.splice(i, 1)
        }
        applied.push(`- ${node.id}${orphaned ? ` (${orphaned})` : ''}`)
        break
      }
    }
  }

  return { diagram: { ...diagram, nodes, groups, edges }, applied, rejected }
}
