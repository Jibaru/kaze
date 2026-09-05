/**
 * Translation between the React Flow graph (what you manipulate) and the
 * `Diagram` save format (what gets written to disk and, from Phase 2, serialized
 * for the reviewer). Keeping this in one file means the canvas never has to know
 * about the save format and vice versa.
 */
import type { Edge, Node } from '@xyflow/react'
import type { BackgroundStyle, Diagram, DiagramNode, EdgeStyle, GroupKind, NodeProps } from '@shared/types'

export type ServiceNodeData = { serviceId: string; label: string; props: NodeProps }
export type GroupNodeData = { kind: GroupKind; label: string }

export type KazeNode =
  | Node<ServiceNodeData, 'service'>
  | Node<ServiceNodeData, 'lifeline'>
  | Node<ServiceNodeData, 'note'>
  | Node<GroupNodeData, 'group'>

/**
 * Which renderer a node gets. Driven by the manifest rather than stored on the
 * node, so the save format stays a save format: a lifeline is a service id like
 * any other, and what it looks like is the app's business.
 */
export const nodeKindFor = (serviceId: string): 'service' | 'lifeline' | 'note' =>
  serviceId === 'Lifeline' ? 'lifeline' : serviceId === 'Note' ? 'note' : 'service'
export type KazeEdge = Edge<{ protocol?: string; label?: string; step?: number }>

/**
 * What a connection says on the canvas.
 *
 * Three fields rather than one because they are read by different readers.
 * `protocol` is the one the app has an opinion about: an edge without one
 * raises the `untyped_edge` gap, and it is serialized as a key the reviewer can
 * argue with. `label` is yours — "cache miss", "async", "solo lectura" — and
 * the reviewer only sees it as prose.
 *
 * `step` is the position in an ordered exchange, and leads: in a sequence it is
 * the first thing you read.
 *
 * They are shown together because a connection carrying all three and drawing
 * only one is a connection that lies about what you typed.
 */
export const edgeText = (protocol?: string, label?: string, step?: number): string | undefined => {
  const body = [protocol?.trim(), label?.trim()].filter(Boolean).join(' · ')
  if (step === undefined) return body || undefined
  // The number leads: in an ordered exchange it is the first thing you read,
  // and a step with nothing else to say still needs to be numbered.
  return body ? `${step}. ${body}` : `${step}.`
}

export const GROUP_DEFAULT_SIZE = { width: 420, height: 300 }

/** How the canvas is drawn. Travels with the diagram, never into `kaze-adl`. */
export interface ViewOptions {
  edgeStyle: EdgeStyle
  background: BackgroundStyle
}

export const DEFAULT_VIEW: ViewOptions = { edgeStyle: 'bezier', background: 'dots' }

/** React Flow calls the bezier one `default`; every other name matches. */
export const flowEdgeType = (style: EdgeStyle): string => (style === 'bezier' ? 'default' : style)

export function viewOf(diagram: Diagram): ViewOptions {
  return {
    edgeStyle: diagram.edgeStyle ?? DEFAULT_VIEW.edgeStyle,
    background: diagram.background ?? DEFAULT_VIEW.background,
  }
}

export function toFlow(diagram: Diagram): { nodes: KazeNode[]; edges: KazeEdge[] } {
  // Groups first: React Flow requires a parent to be earlier in the array than
  // its children, or children render detached on first paint.
  const groups: KazeNode[] = diagram.groups.map((g) => ({
    id: g.id,
    type: 'group',
    position: { x: g.x, y: g.y },
    data: { kind: g.kind, label: g.label },
    style: { width: g.width, height: g.height },
    ...(g.parentId ? { parentId: g.parentId, extent: 'parent' as const } : {}),
  }))

  const nodes: KazeNode[] = diagram.nodes.map((n) => ({
    id: n.id,
    type: nodeKindFor(n.serviceId),
    position: { x: n.x, y: n.y },
    data: { serviceId: n.serviceId, label: n.label, props: n.props },
    ...(n.parentId ? { parentId: n.parentId, extent: 'parent' as const } : {}),
  }))

  const type = flowEdgeType(viewOf(diagram).edgeStyle)
  const edges: KazeEdge[] = diagram.edges.map((e) => ({
    id: e.id,
    source: e.from,
    target: e.to,
    type,
    label: edgeText(e.protocol, e.label, e.step),
    data: {
      ...(e.protocol ? { protocol: e.protocol } : {}),
      ...(e.label ? { label: e.label } : {}),
      ...(e.step !== undefined ? { step: e.step } : {}),
    },
    ...(e.fromHandle ? { sourceHandle: e.fromHandle } : {}),
    ...(e.toHandle ? { targetHandle: e.toHandle } : {}),
  }))

  return { nodes: [...groups, ...nodes], edges }
}

export function fromFlow(
  nodes: KazeNode[],
  edges: KazeEdge[],
  scenarioId: string,
  view: ViewOptions = DEFAULT_VIEW,
): Diagram {
  const serviceNodes: DiagramNode[] = []
  const groups: Diagram['groups'] = []

  for (const n of nodes) {
    if (n.type === 'group') {
      groups.push({
        id: n.id,
        kind: n.data.kind,
        label: n.data.label,
        x: n.position.x,
        y: n.position.y,
        width: Number(n.style?.width ?? GROUP_DEFAULT_SIZE.width),
        height: Number(n.style?.height ?? GROUP_DEFAULT_SIZE.height),
        ...(n.parentId ? { parentId: n.parentId } : {}),
      })
    } else {
      serviceNodes.push({
        id: n.id,
        serviceId: n.data.serviceId,
        label: n.data.label,
        props: n.data.props,
        x: n.position.x,
        y: n.position.y,
        ...(n.parentId ? { parentId: n.parentId } : {}),
      })
    }
  }

  return {
    version: 1,
    scenarioId,
    edgeStyle: view.edgeStyle,
    background: view.background,
    nodes: serviceNodes,
    groups,
    edges: edges.map((e) => ({
      id: e.id,
      from: e.source,
      to: e.target,
      ...(e.data?.protocol ? { protocol: e.data.protocol } : {}),
      ...(e.data?.label ? { label: e.data.label } : {}),
      ...(e.data?.step !== undefined ? { step: e.data.step } : {}),
      ...(e.sourceHandle ? { fromHandle: e.sourceHandle } : {}),
      ...(e.targetHandle ? { toHandle: e.targetHandle } : {}),
    })),
  }
}

/**
 * Turn a connection around.
 *
 * The handles swap with the ends, or a flipped line would leave from the side
 * it used to arrive at and cross back over the node. The id is left alone: it
 * is the same connection, drawn the other way.
 */
export function flipEdges(edges: KazeEdge[], ids: Set<string>): KazeEdge[] {
  return edges.map((e) =>
    ids.has(e.id)
      ? {
          ...e,
          source: e.target,
          target: e.source,
          sourceHandle: e.targetHandle ?? null,
          targetHandle: e.sourceHandle ?? null,
        }
      : e,
  )
}

/** Node ids are user-visible: they appear in findings ("the DB at n5"). */
export function nextNodeId(existing: KazeNode[]): string {
  const used = new Set(existing.filter((n) => n.type === 'service').map((n) => n.id))
  for (let i = 1; ; i++) {
    const id = `n${i}`
    if (!used.has(id)) return id
  }
}

export function nextGroupId(existing: KazeNode[], kind: GroupKind): string {
  const used = new Set(existing.map((n) => n.id))
  for (let i = 1; ; i++) {
    const id = i === 1 ? kind : `${kind}-${i}`
    if (!used.has(id)) return id
  }
}

/**
 * Which side of each box a connection should leave from and arrive at.
 *
 * A connection drawn by hand carries the sides you dragged between. One the
 * model added carries none — it says what talks to what, which is the part it
 * can reason about, and nothing about geometry, which it cannot. React Flow
 * then falls back to the same default handle for every edge, so every line
 * leaves the top of one box and arrives at the top of another and loops around
 * everything in between.
 *
 * So the sides are chosen from where the boxes actually are. Horizontal wins
 * ties because these diagrams read left to right: request goes right, storage
 * hangs below.
 *
 * Deliberately computed for drawing and never saved. It is not a decision
 * anyone made — it is a consequence of the current layout, and it should follow
 * the boxes when you drag them rather than freezing the first arrangement the
 * model happened to produce.
 */
const HANDLE_DEFAULT_SIZE = { width: 140, height: 40 }

export function autoSides(
  from: { x: number; y: number; width?: number; height?: number },
  to: { x: number; y: number; width?: number; height?: number },
): { sourceHandle: string; targetHandle: string } {
  const centre = (n: { x: number; y: number; width?: number; height?: number }) => ({
    x: n.x + (n.width ?? HANDLE_DEFAULT_SIZE.width) / 2,
    y: n.y + (n.height ?? HANDLE_DEFAULT_SIZE.height) / 2,
  })
  const a = centre(from)
  const b = centre(to)
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0
      ? { sourceHandle: 'right', targetHandle: 'left' }
      : { sourceHandle: 'left', targetHandle: 'right' }
  }
  return dy >= 0
    ? { sourceHandle: 'bottom', targetHandle: 'top' }
    : { sourceHandle: 'top', targetHandle: 'bottom' }
}

/** How many message slots a lifeline offers down its length. */
export const LIFELINE_SLOTS = 8

/**
 * The handles an ordered message attaches to.
 *
 * This is what turns a row of boxes into a sequence diagram. A lifeline is tall
 * and carries a handle per step down each side, so `step: 3` means "the third
 * row", and the vertical position *is* the order — which is the one thing a
 * box-and-arrow diagram cannot say and the reason sequence diagrams exist.
 *
 * Derived for drawing and never saved, like the sides everywhere else: renumber
 * a step and the message moves.
 */
export const stepHandles = (
  step: number,
  self = false,
): { sourceHandle: string; targetHandle: string } => {
  const slot = Math.min(LIFELINE_SLOTS, Math.max(1, Math.round(step)))
  // A message to another lifeline uses the same slot at both ends: it is a
  // horizontal line at that row, and which participant is to the left is a
  // fact about the layout rather than about the message.
  if (!self) return { sourceHandle: `s${slot}`, targetHandle: `s${slot}` }
  // A message to itself leaves one row and returns on the next, from the
  // outside edge — which is the bracket a self-call is always drawn as, and
  // the only way to draw one at all when both ends are the same point.
  return {
    sourceHandle: `o${slot}`,
    targetHandle: `o${Math.min(LIFELINE_SLOTS, slot + 1)}`,
  }
}

/**
 * Where every node is on the canvas, not on its parent.
 *
 * A node inside a boundary is positioned relative to it, so comparing a node in
 * an availability zone with one outside it means adding the parents up first.
 */
export function absoluteBoxes(
  nodes: KazeNode[],
): Map<string, { x: number; y: number; width?: number; height?: number }> {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const boxes = new Map<string, { x: number; y: number; width?: number; height?: number }>()

  const resolve = (node: KazeNode, seen: Set<string>): { x: number; y: number } => {
    const cached = boxes.get(node.id)
    if (cached) return cached
    let origin = { x: 0, y: 0 }
    // `seen` guards a parent cycle. It should not be possible; a stack overflow
    // while drawing would be a poor way to find out that it was.
    if (node.parentId && !seen.has(node.parentId)) {
      const parent = byId.get(node.parentId)
      if (parent) origin = resolve(parent, new Set([...seen, node.id]))
    }
    const box = {
      x: origin.x + node.position.x,
      y: origin.y + node.position.y,
      width: node.measured?.width ?? (node.width as number | undefined),
      height: node.measured?.height ?? (node.height as number | undefined),
    }
    boxes.set(node.id, box)
    return box
  }

  for (const node of nodes) resolve(node, new Set())
  return boxes
}
