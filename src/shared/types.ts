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
  | 'Actors'
  /** Not part of the system: notes and step markers that explain it. */
  | 'Notation'
  /** Lifelines, for drawing what happens in what order. */
  | 'Sequence'
  /** C4 levels, for the structure above the services. */
  | 'C4'
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
  | 'Other'

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
  /**
   * Lives outside the system being designed — a person, another company's
   * service. Drawing one inside a VPC is a modelling mistake, not a choice.
   */
  external?: boolean
  /**
   * Explains the diagram rather than being part of it: a note, a lifeline.
   *
   * Excluded from every gap rule. A note with no connections is a note, not an
   * unconnected component, and a review that opens by complaining about the
   * annotations is a review nobody reads.
   */
  annotation?: boolean
}

/**
 * `lane` is not an AWS boundary — it is a phase, a step, a swimlane. It exists
 * because explaining a system means grouping by *when* as often as by *where*.
 */
export type GroupKind = 'account' | 'region' | 'vpc' | 'az' | 'subnet' | 'lane'

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
  /**
   * Position in an ordered exchange, drawn as a numbered badge.
   *
   * On a pair of lifelines it is also the vertical slot the message attaches
   * to, which is what turns a row of boxes into a sequence diagram: the app
   * derives the handles from it, the same way it derives the sides from the
   * layout everywhere else.
   */
  step?: number
  /**
   * Which side of each node the line attaches to. Presentation, like
   * `edgeStyle`: saved so the drawing survives a reload, and never serialized
   * into `kaze-adl`, where it would be noise.
   */
  fromHandle?: string
  toHandle?: string
}

/** How an edge is drawn. Presentation only — see `Diagram`. */
export type EdgeStyle = 'bezier' | 'straight' | 'step' | 'smoothstep'

/** What the canvas is drawn on. */
export type BackgroundStyle = 'dots' | 'grid' | 'none'

export interface Diagram {
  version: 1
  scenarioId: string
  nodes: DiagramNode[]
  groups: DiagramGroup[]
  edges: DiagramEdge[]
  /**
   * How the canvas looks. Saved with the diagram so it survives a restart, and
   * deliberately absent from `kaze-adl`: whether a connection is drawn curved
   * or square-cornered is not something a reviewer can have an opinion about,
   * and putting it in the serialized design would invite one.
   */
  edgeStyle?: EdgeStyle
  background?: BackgroundStyle
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

/**
 * A concept to study, as the learner sees it.
 *
 * The checks are stripped in the main process, the same way a scenario's rubric
 * is: rehearsing the answers is not learning.
 */
export interface Concept {
  id: string
  title: string
  service: string
  difficulty: number
  /** How many ideas the lesson works through. The app owns the count. */
  steps: number
  summary: string
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

/**
 * One exchange in conversation mode: what to say, what to draw, and the audio.
 *
 * The operations are proposals — the renderer validates and applies them the
 * same way it does an autofix, and tells the next turn what it refused.
 */
export interface ChatTurn {
  say: string
  ops: import('./patch').PatchOp[]
  /**
   * Which utterance the audio chunks belong to. The speech is streamed on
   * `chat:audio` as it is generated — it starts arriving *before* this reply
   * does — so the player keys on this rather than waiting to be handed a file.
   */
  audioSeq: number
}

/** One slice of streamed speech. `chunk` is null when the utterance is over. */
export interface ChatAudio {
  seq: number
  /** base64 PCM: 24 kHz, signed 16-bit little-endian, mono. */
  chunk: string | null
}

/** What the app needs to pick an attempt back up after a restart. */
export interface AttemptMeta {
  /** The Claude Code conversation this attempt has been running in. */
  sessionId?: string
  createdAt?: string
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
  /** Asks the model to write a scenario, rubric included, and stores it. */
  createScenario(topic: string, difficulty: number): Promise<{ id: string } | { error: string }>
  revealScenarios(): Promise<string>
  /** Photographs a rectangle of the window onto the clipboard. */
  captureCanvas(rect: {
    x: number
    y: number
    width: number
    height: number
  }): Promise<{ width: number; height: number }>
  /** Puts text on the system clipboard. */
  copyText(text: string): Promise<void>
  /** Abandon an authoring turn: closing the dialog should not leave it running. */
  cancelScenario(): Promise<void>
  getLocale(): Promise<import('./i18n').Locale>
  setLocale(locale: import('./i18n').Locale): Promise<void>
  /** Whether reviews and questions take the lean, toolless path. */
  getFastMode(): Promise<boolean>
  setFastMode(on: boolean): Promise<void>
  /** Snapshots the design, then runs one turn against it. */
  review(diagram: Diagram, intent: TurnIntent, question?: string): Promise<ReviewOutcome>
  cancelTurn(): Promise<void>
  /** Archives the current attempt and starts an empty one. */
  newSession(): Promise<{ archivedTo: string } | { cancelled: true }>
  /** Operations that answer one finding. The renderer validates and applies them. */
  proposeFix(claim: string, fix: string): Promise<import('./patch').PatchOp[]>
  /** Enter conversation mode: frames the case, draws nothing. */
  openChat(diagram: Diagram, speed: number): Promise<ChatTurn>
  /**
   * One spoken exchange. `refused` is what the app rejected last turn, `speed`
   * how fast to read the reply — asked of the synthesizer rather than done to
   * the audio afterwards, so the voice keeps its pitch and there is less of it
   * to wait for.
   */
  sayToChat(
    said: string,
    refused: string[],
    speed: number,
    /** What is on the canvas now. The app assigns node ids, so this is the
     *  only way the model learns them. */
    diagram: Diagram,
  ): Promise<ChatTurn>
  /** Streamed speech for conversation mode. Returns the unsubscribe. */
  onChatAudio(handler: (audio: ChatAudio) => void): () => void
  /** Leaving the mode: lets go of the process it was holding open. */
  closeChat(): Promise<void>
  listConcepts(): Promise<Concept[]>
  /** Start a lesson: says what the concept is, draws nothing. */
  openLesson(conceptId: string, diagram: Diagram, speed: number): Promise<ChatTurn>
  /** One exchange in a lesson. `step` of `steps` is the app's count, not the model's. */
  sayToLesson(
    said: string,
    refused: string[],
    speed: number,
    diagram: Diagram,
    step: number,
    steps: number,
  ): Promise<ChatTurn>
  hasVoiceKey(): Promise<boolean>
  setVoiceKey(key: string): Promise<void>
  transcribe(audio: ArrayBuffer, mimeType: string): Promise<string>
  onReviewEvent(handler: (event: ReviewEvent) => void): () => void
}
