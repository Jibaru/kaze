/** Shapes crossing the main <-> renderer boundary, and the diagram model itself. */

/**
 * A configurable property the reviewer actually cares about.
 *
 * `key` is canonical and appears in the serialized design, so it never changes
 * with the interface language; the human-readable label and placeholder live in
 * the dictionary, keyed by it.
 */
export type PropSpec =
  | { key: string; kind: 'bool' }
  | { key: string; kind: 'text' }
  | { key: string; kind: 'enum'; options: string[] }

export type Category =
  | 'Compute'
  | 'Containers'
  | 'Storage'
  | 'Database'
  | 'Networking'
  | 'Edge'
  | 'Integration'
  | 'Analytics'
  | 'Security'
  | 'Observability'

/**
 * Review-relevant metadata driving the `gaps:` section of the serialized
 * design. These are the questions an interviewer asks about a box on a
 * whiteboard, encoded so the app can ask them before the model has to.
 */
export interface ServiceFlags {
  /** Holds state, so losing it loses data. */
  statefulStore?: boolean
  /** Should be spread across AZs; single-AZ placement is a finding. */
  needsMultiAz?: boolean
  /** Needs a stated backup or retention policy. */
  needsBackup?: boolean
  /** Faces the internet — the edge of the trust boundary. */
  entryPoint?: boolean
  /** Scales by configuration rather than automatically. */
  needsScalingPolicy?: boolean
}

export type GroupKind = 'account' | 'region' | 'vpc' | 'az' | 'subnet'

export type NodeProps = Record<string, string | boolean>

/** Persisted diagram. Deliberately flat and boring: it is a save format. */
export interface DiagramNode {
  id: string
  serviceId: string
  label: string
  props: NodeProps
  x: number
  y: number
  parentId?: string
}

export interface DiagramGroup {
  id: string
  kind: GroupKind
  label: string
  x: number
  y: number
  width: number
  height: number
  parentId?: string
}

export interface DiagramEdge {
  id: string
  from: string
  to: string
  protocol?: string
  label?: string
}

export interface Diagram {
  version: 1
  scenarioId: string
  nodes: DiagramNode[]
  groups: DiagramGroup[]
  edges: DiagramEdge[]
}

export const emptyDiagram = (scenarioId = 'scratch'): Diagram => ({
  version: 1,
  scenarioId,
  nodes: [],
  groups: [],
  edges: [],
})

/** A practice brief. The rubric is stripped in the main process and never
 *  reaches the renderer. */
export interface Scenario {
  id: string
  title: string
  difficulty: number
  brief: string
}

/** Which key you held: a rubric pass, or an ordinary question. */
export type TurnIntent = 'review' | 'ask'

/** Everything the main process streams to the renderer during a turn. */
export type ReviewEvent =
  | { kind: 'turn-start'; intent: TurnIntent }
  | { kind: 'session'; sessionId: string }
  | { kind: 'delta'; text: string }
  | { kind: 'tool'; name: string }
  | { kind: 'warning'; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'result'; ok: boolean; costUSD: number | null; durationMs: number | null }
  | { kind: 'turn-end'; intent: TurnIntent; cancelled: boolean }

/** What a completed review turn produced. */
export interface ReviewOutcome {
  intent: TurnIntent
  markdown: string
  payload: import('./findings').ReviewPayload | null
  problem: import('./findings').ReviewProblem | null
  revision: number | null
  /** The reconciled ledger after this turn: statuses, not just findings. */
  ledger: import('./ledger').Ledger | null
  /** base64 mp3 of the spoken summary, when there was one to speak. */
  audio: string | null
}

/** Result of snapshotting a design as a numbered revision. */
export interface RevisionResult {
  revision: number
  designPath: string
  revisionPath: string
  diff: import('./adl').DiagramDiff
  document: string
}

/** The surface the preload exposes. Kept narrow on purpose. */
export interface KazeApi {
  saveDiagram(diagram: Diagram): Promise<{ path: string }>
  loadDiagram(): Promise<Diagram | null>
  snapshotRevision(diagram: Diagram): Promise<RevisionResult>
  workspacePath(): Promise<string>
  listScenarios(): Promise<Scenario[]>
  getLocale(): Promise<import('./i18n').Locale>
  setLocale(locale: import('./i18n').Locale): Promise<void>
  /** Snapshots the design, then runs one turn against it. */
  review(diagram: Diagram, intent: TurnIntent, question?: string): Promise<ReviewOutcome>
  cancelTurn(): Promise<void>
  hasVoiceKey(): Promise<boolean>
  setVoiceKey(key: string): Promise<void>
  transcribe(audio: ArrayBuffer, mimeType: string): Promise<string>
  onReviewEvent(handler: (event: ReviewEvent) => void): () => void
}
