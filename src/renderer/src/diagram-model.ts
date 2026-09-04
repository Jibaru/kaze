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

export type KazeNode = Node<ServiceNodeData, 'service'> | Node<GroupNodeData, 'group'>
export type KazeEdge = Edge<{ protocol?: string }>

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
    type: 'service',
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
    label: e.protocol ?? e.label,
    data: e.protocol ? { protocol: e.protocol } : {},
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
      ...(e.sourceHandle ? { fromHandle: e.sourceHandle } : {}),
      ...(e.targetHandle ? { toHandle: e.targetHandle } : {}),
    })),
  }
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
