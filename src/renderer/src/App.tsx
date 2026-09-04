import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  addEdge,
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  type Connection,
  type NodeTypes,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { ChatTurn, GroupKind, NodeProps as ConfigProps, ReviewOutcome, Scenario, TurnIntent } from '@shared/types'
import type { ReviewProblem } from '@shared/findings'
import type { LedgerEntry } from '@shared/ledger'
import { LOCALE_NAMES, LOCALES, type Locale } from '@shared/i18n'
import { emptyDiagram, type Diagram } from '@shared/types'
import { getService, type ServiceSpec } from '@shared/services'
import { ServiceNode } from './canvas/ServiceNode'
import { GroupNode } from './canvas/GroupNode'
import { CanvasOptions } from './canvas/CanvasOptions'
import { Palette } from './palette/Palette'
import { ScenarioPanel } from './scenario/ScenarioPanel'
import { Inspector } from './inspector/Inspector'
import { EdgeInspector } from './inspector/EdgeInspector'
import { ConversationBar, type ChatState } from './conversation/ConversationBar'
import { useVoiceLoop } from './voice/useVoiceLoop'
import { useStreamedSpeech } from './voice/useStreamedSpeech'
import { useAudioInputs } from './voice/useAudioInputs'
import { applyPatch, type PatchOp } from '@shared/patch'
import { serialize } from '@shared/adl'
import { Toast } from './toast/Toast'
import { DesignText } from './review/DesignText'
import { ReviewPanel } from './review/ReviewPanel'
import { usePushToTalk } from './voice/usePushToTalk'
import { useSpokenSummary } from './voice/useSpokenSummary'
import { AskPopover } from './voice/AskPopover'
import { LocaleProvider, useLocale } from './i18n/useLocale'
import {
  DEFAULT_VIEW,
  flowEdgeType,
  absoluteBoxes,
  autoSides,
  edgeText,
  flipEdges,
  fromFlow,
  GROUP_DEFAULT_SIZE,
  nextGroupId,
  nextNodeId,
  toFlow,
  viewOf,
  type KazeEdge,
  type KazeNode,
  type ViewOptions,
} from './diagram-model'

const nodeTypes: NodeTypes = { service: ServiceNode as never, group: GroupNode as never }

const GROUP_KINDS: GroupKind[] = ['vpc', 'az', 'subnet', 'region', 'account']

/** Assistant text arrives as deltas either side of a tool call; without this
 *  they run together into one wall of prose. */
const SEP = '\n\n'

function Canvas() {
  const { locale, t, setLocale } = useLocale()
  const [nodes, setNodes, onNodesChange] = useNodesState<KazeNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<KazeEdge>([])
  const [status, setStatus] = useState('')
  const [tab, setTab] = useState<'inspector' | 'text' | 'review'>('inspector')
  const [transcript, setTranscript] = useState('')
  const [outcome, setOutcome] = useState<ReviewOutcome | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [scenarioId, setScenarioId] = useState('')
  const [view, setView] = useState<ViewOptions>(DEFAULT_VIEW)
  const [fixing, setFixing] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  /** The diagram as it was before the last applied fix, for a single undo. */
  const [beforeFix, setBeforeFix] = useState<Diagram | null>(null)
  const [hasVoiceKey, setHasVoiceKey] = useState(false)
  /** Mirrors the preference main holds; main is the one that decides. */
  const [fast, setFast] = useState(false)
  /**
   * Conversation mode. `null` when off — the mode owns its own transcript and
   * throws it away on exit, because the diagram is what it produced and the
   * diagram is what you keep.
   */
  const [chat, setChat] = useState<{ say: string; busy: boolean; refused: string[] } | null>(null)
  const [muted, setMuted] = useState(false)
  /**
   * Whatever went wrong with the microphone, shown *in the mode*. It used to go
   * to the status bar, which conversation mode hides — so a denied microphone,
   * a failed transcription or a turn that heard nothing all looked exactly like
   * the app ignoring you.
   */
  const [chatNote, setChatNote] = useState('')
  /** Space held: record whatever the detector thinks. */
  const [holding, setHolding] = useState(false)
  /** Read inside a callback that must not re-register on every turn. */
  const chatRef = useRef(chat)
  chatRef.current = chat
  const [keyDraft, setKeyDraft] = useState('')
  const [dirty, setDirty] = useState(false)
  const wrapper = useRef<HTMLDivElement>(null)
  const { screenToFlowPosition, fitView, getViewport, setViewport } = useReactFlow()
  const nodesInitialized = useNodesInitialized()
  const hasFitted = useRef(false)

  const selected = useMemo(() => nodes.find((n) => n.selected) ?? null, [nodes])
  // The save format is also the review format, so it is derived live rather
  // than only on save — the text panel must never lag the canvas.
  const diagram = useMemo(() => fromFlow(nodes, edges, scenarioId, view), [nodes, edges, scenarioId, view])
  // `defaultEdgeOptions` only reaches edges created after the change, so the
  // type is applied at render time. Changing the setting should redraw the
  // diagram you already have, not just the next connection you make.
  const drawnEdges = useMemo(() => {
    const boxes = absoluteBoxes(nodes)
    return edges.map((e) => {
      // Only where nobody chose: a connection you dragged keeps the sides you
      // dragged it between. One the model added has no opinion about geometry,
      // and letting React Flow use its default handle for all of them is why
      // every line used to leave the top of one box and arrive at the top of
      // another.
      const from = boxes.get(e.source)
      const to = boxes.get(e.target)
      const sides = !e.sourceHandle && !e.targetHandle && from && to ? autoSides(from, to) : null
      return {
        ...e,
        ...(sides ?? {}),
        type: flowEdgeType(view.edgeStyle),
        // The protocol sat directly on the line, in the gap between two boxes,
        // where it was both unreadable and in the way. A chip lifts it off.
        labelShowBg: true,
        labelBgStyle: { fill: '#fff', fillOpacity: 0.94, stroke: '#e8eaed' },
        labelBgPadding: [6, 3] as [number, number],
        labelBgBorderRadius: 6,
        labelStyle: { fill: '#5f6368', fontSize: 11 },
        // The arrow points at whoever receives the call. Direction is already
        // in the serialized design and the review already argues about it, so
        // leaving it invisible means reviewing a claim the user cannot see.
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 18,
          height: 18,
          // Markers are SVG defs, not CSS, so the selected colour has to be
          // chosen here rather than inherited from the path.
          color: e.selected ? '#1a73e8' : '#9aa0a6',
        },
      }
    })
    // Recomputed as the boxes move: the sides are a consequence of the layout,
    // so dragging a node reroutes what it is connected to.
  }, [edges, nodes, view.edgeStyle])
  const serviceCount = nodes.filter((n) => n.type === 'service').length

  const markDirty = useCallback(() => setDirty(true), [])

  const addService = useCallback(
    (spec: ServiceSpec, position?: { x: number; y: number }) => {
      setNodes((current) => {
        const id = nextNodeId(current)
        const node: KazeNode = {
          id,
          type: 'service',
          position: position ?? { x: 220 + (current.length % 5) * 200, y: 120 + Math.floor(current.length / 5) * 140 },
          data: { serviceId: spec.id, label: spec.name, props: {} },
        }
        return [...current, node]
      })
      markDirty()
    },
    [setNodes, markDirty],
  )

  const addGroup = useCallback(
    (kind: GroupKind) => {
      setNodes((current) => {
        const id = nextGroupId(current, kind)
        const group: KazeNode = {
          id,
          type: 'group',
          position: { x: 80, y: 60 },
          data: { kind, label: id },
          style: { ...GROUP_DEFAULT_SIZE },
        }
        // Groups must precede their children in the array or React Flow renders
        // the children detached until the next update.
        return [group, ...current]
      })
      markDirty()
    },
    [setNodes, markDirty],
  )

  const onConnect = useCallback(
    (c: Connection) => {
      // The handles are part of the id: two lines between the same pair of
      // nodes are legitimate now that there are four sides to attach to.
      setEdges((eds) =>
        addEdge({ ...c, id: `e-${c.source}${c.sourceHandle ?? ''}-${c.target}${c.targetHandle ?? ''}` }, eds),
      )
      markDirty()
    },
    [setEdges, markDirty],
  )

  const setLabel = useCallback(
    (id: string, label: string) => {
      setNodes((ns) => ns.map((n) => (n.id === id ? ({ ...n, data: { ...n.data, label } } as KazeNode) : n)))
      markDirty()
    },
    [setNodes, markDirty],
  )

  const setProps = useCallback(
    (id: string, props: ConfigProps) => {
      setNodes((ns) => ns.map((n) => (n.id === id ? ({ ...n, data: { ...n.data, props } } as KazeNode) : n)))
      markDirty()
    },
    [setNodes, markDirty],
  )

  const removeNode = useCallback(
    (id: string) => {
      setNodes((ns) => ns.filter((n) => n.id !== id && n.parentId !== id))
      setEdges((es) => es.filter((e) => e.source !== id && e.target !== id))
      markDirty()
    },
    [setNodes, setEdges, markDirty],
  )

  const save = useCallback(async () => {
    const { path } = await window.kaze.saveDiagram(diagram)
    setDirty(false)
    setStatus(t.savedNodes(diagram.nodes.length, path))
  }, [diagram, t])

  /** Freeze the current design as a numbered revision — what a review reads. */
  const snapshot = useCallback(async () => {
    const result = await window.kaze.snapshotRevision(diagram)
    setDirty(false)
    const changed =
      result.diff.addedNodes.length + result.diff.removedNodes.length + result.diff.changedProps.length
    setStatus(t.revisionWritten(result.revision, changed))
  }, [diagram, t])

  const speech = useSpokenSummary()

  /** Reload the bank after authoring, and start practising the new brief. */
  const adoptScenario = useCallback(
    async (id: string) => {
      const found = await window.kaze.listScenarios()
      setScenarios(found)
      setScenarioId(id)
      setStatus(t.scenarioCreated(found.find((s) => s.id === id)?.title ?? id))
    },
    [t],
  )

  /**
   * The whole diagram, not the visible part of the window.
   *
   * Everything is fitted into view first, then the canvas rectangle is
   * photographed by the compositor. Rasterising the DOM was tried twice and
   * lost every edge both times: React Flow paints each connection in a small
   * <svg> that spills outside its own box, which holds on screen and does not
   * survive rasterisation. Asking for what is already drawn cannot have that
   * class of gap.
   */
  const copyImage = useCallback(async () => {
    const pane = document.querySelector<HTMLElement>('.react-flow')
    if (!pane || nodes.length === 0) {
      setStatus(t.nothingToCopy)
      return
    }

    // The overlays are chrome, not design. Hidden through a class rather than
    // inline styles, which React can overwrite on its next render.
    const previousViewport = getViewport()
    pane.classList.add('is-capturing')
    fitView({ padding: 0.12, duration: 0 })

    // Two frames for the fit and the class to be painted, then a beat for the
    // compositor to commit them. `capturePage` reads the composited frame, so
    // without the pause it photographs the toolbar it was told to hide — which
    // is exactly what the first version did.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    await new Promise((resolve) => setTimeout(resolve, 120))

    try {
      const box = pane.getBoundingClientRect()
      const size = await window.kaze.captureCanvas({
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
      })
      setToast(t.imageCopied(size.width, size.height))
    } catch (err) {
      setStatus(t.copyFailed(err instanceof Error ? err.message : String(err)))
    } finally {
      pane.classList.remove('is-capturing')
      setViewport(previousViewport)
    }
  }, [nodes, t, fitView, getViewport, setViewport])

  /**
   * Apply the change one finding calls for.
   *
   * The model proposes operations and the app validates and applies them, so a
   * fix can be read in the diagram rather than taken on trust. The finding is
   * left open: whether it is actually resolved is for the next review to say,
   * which is the same rule the ledger already lives by.
   */
  const applyFix = useCallback(
    async (entry: LedgerEntry) => {
      setFixing(entry.id)
      setStatus(t.applyingFix)
      try {
        const ops = await window.kaze.proposeFix(entry.claim, entry.fix)
        const result = applyPatch(diagram, ops)
        if (result.applied.length === 0) {
          setStatus(result.rejected[0] ? t.fixRejected(result.rejected[0].reason) : t.fixNothing)
          return
        }
        setBeforeFix(diagram)
        const flow = toFlow(result.diagram)
        setNodes(flow.nodes)
        setEdges(flow.edges)
        markDirty()
        setStatus(
          result.rejected.length > 0
            ? `${t.fixApplied(result.applied.join(' · '))} — ${t.fixRejected(result.rejected[0]!.reason)}`
            : t.fixApplied(result.applied.join(' · ')),
        )
      } catch (err) {
        setStatus(err instanceof Error ? err.message : String(err))
      } finally {
        setFixing(null)
      }
    },
    [diagram, setNodes, setEdges, markDirty, t],
  )

  /** Archive the attempt and start clean: empty canvas, empty ledger, new turn. */
  const newSession = useCallback(async () => {
    const result = await window.kaze.newSession()
    if ('cancelled' in result) return
    setNodes([])
    setEdges([])
    setOutcome(null)
    setTranscript('')
    setBeforeFix(null)
    setDirty(false)
    setStatus(t.sessionArchived)
  }, [setNodes, setEdges, t])

  /**
   * The design as the reviewer reads it, on the clipboard.
   *
   * Gaps included: the point of pasting this somewhere is to carry the whole
   * picture, and what the app noticed is part of it.
   */
  const copyText = useCallback(async () => {
    if (nodes.length === 0) {
      setStatus(t.nothingToCopy)
      return
    }
    const text = serialize(diagram)
    await window.kaze.copyText(text)
    setToast(t.textCopied(text.trimEnd().split('\n').length))
  }, [diagram, nodes.length, t])

  const undoFix = useCallback(() => {
    if (!beforeFix) return
    const flow = toFlow(beforeFix)
    setNodes(flow.nodes)
    setEdges(flow.edges)
    setBeforeFix(null)
    setStatus(t.undone)
  }, [beforeFix, setNodes, setEdges, t])

  const selectedEdges = useMemo(() => edges.filter((e) => e.selected), [edges])
  const selectedEdgeIds = useMemo(
    () => new Set(selectedEdges.map((e) => e.id)),
    [selectedEdges],
  )

  /**
   * What a connection says. Both fields are stored on the edge's `data` and the
   * rendered text is derived from them, so a line carrying a protocol and a
   * note draws both rather than quietly showing one.
   */
  const setEdgeText = useCallback(
    (ids: string[], patch: { protocol?: string; label?: string }) => {
      const set = new Set(ids)
      setEdges((es) =>
        es.map((e) => {
          if (!set.has(e.id)) return e
          const data = { ...e.data, ...patch }
          return { ...e, data, label: edgeText(data.protocol, data.label) }
        }),
      )
      markDirty()
    },
    [setEdges, markDirty],
  )

  const removeEdges = useCallback(
    (ids: string[]) => {
      const set = new Set(ids)
      setEdges((es) => es.filter((e) => !set.has(e.id)))
      markDirty()
    },
    [setEdges, markDirty],
  )

  const flipSelectedEdges = useCallback(() => {
    if (selectedEdgeIds.size === 0) return
    setEdges((current) => flipEdges(current, selectedEdgeIds))
    markDirty()
    setStatus(t.edgesFlipped(selectedEdgeIds.size))
  }, [selectedEdgeIds, setEdges, markDirty, t])

  const selectNodes = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return
      setNodes((ns) => ns.map((n) => ({ ...n, selected: ids.includes(n.id) })))
    },
    [setNodes],
  )

  const load = useCallback(async () => {
    const diagram = await window.kaze.loadDiagram()
    if (!diagram) {
      setStatus(t.nothingSaved)
      return
    }
    const flow = toFlow(diagram)
    setNodes(flow.nodes)
    setEdges(flow.edges)
    setDirty(false)
    setStatus(t.loaded(diagram.nodes.length, diagram.edges.length))
  }, [setNodes, setEdges, t])

  // Reopen where you left off. A practice tool that forgets your diagram on
  // restart is a tool you stop opening.
  useEffect(() => {
    void (async () => {
      const found = await window.kaze.listScenarios()
      setScenarios(found)
      const saved = await window.kaze.loadDiagram()
      const restored = saved ?? emptyDiagram()
      const flow = toFlow(restored)
      setNodes(flow.nodes)
      setEdges(flow.edges)
      // A design must name a scenario that exists, or the review is judged
      // against a file that isn't there.
      const known = found.some((s) => s.id === restored.scenarioId)
      setScenarioId(known ? restored.scenarioId : (found[0]?.id ?? ''))
      setView(viewOf(restored))
    })()
  }, [setNodes, setEdges])

  // `fitView` on the component only fits what exists at first paint, and the
  // diagram arrives from disk a tick later. Fit once, after the nodes are
  // measured, or a restored design opens half off-screen.
  useEffect(() => {
    if (!nodesInitialized || hasFitted.current || nodes.length === 0) return
    hasFitted.current = true
    void fitView({ padding: 0.15, duration: 200 })
  }, [nodesInitialized, nodes.length, fitView])

  useEffect(
    () =>
      window.kaze.onReviewEvent((event) => {
        switch (event.kind) {
          case 'turn-start':
            setTranscript('')
            setStreaming(true)
            setStatus(event.intent === 'review' ? t.reviewing : t.thinking)
            break
          case 'delta':
            setTranscript((t) => t + event.text)
            break
          case 'tool':
            setStatus(`${event.name}…`)
            setTranscript((t) => (t && !t.endsWith(SEP) ? t + SEP : t))
            break
          case 'warning':
          case 'error':
            setStatus(event.message)
            break
          case 'result':
            setStatus(
              event.ok
                ? t.doneIn(Math.round((event.durationMs ?? 0) / 1000), event.costUSD ?? 0)
                : t.turnError,
            )
            break
          case 'turn-end':
            setStreaming(false)
            if (event.cancelled) setStatus(t.cancelled)
            break
        }
      }),
    [t],
  )

  const runTurn = useCallback(
    async (intent: TurnIntent, text?: string) => {
      setTab('review')
      try {
        const result = await window.kaze.review(diagram, intent, text)
        setOutcome(result)
        // The live stream includes the fenced findings block, which is machinery
        // rather than review. Once the turn lands, show the parsed prose with it
        // stripped out.
        if (result.markdown) setTranscript(result.markdown)
        setDirty(false)
        // The result is spoken as well as written: you asked for it by voice,
        // you get it back by voice, and the transcript is there to read.
        speech.load(result.audio, true)
      } catch (err) {
        setStatus(err instanceof Error ? err.message : String(err))
      }
    },
    [diagram, speech],
  )

  /**
   * Conversation mode.
   *
   * The loop is: it speaks, you answer, it draws and speaks again. The
   * operations go through the same validation as an autofix — the model
   * proposes, the app decides — and whatever the app refuses is handed to the
   * next turn, so it stops referring to a box that was never drawn.
   *
   * The microphone is open except while the app is busy or talking. It could
   * listen through its own speech and let you cut in, and echo cancellation
   * would probably hold; "probably" is the wrong word for a loop that could
   * transcribe its own voice and reply to itself, so barge-in is the button
   * instead.
   */
  const diagramRef = useRef(diagram)
  diagramRef.current = diagram

  const applyOps = useCallback(
    (ops: PatchOp[]): string[] => {
      if (ops.length === 0) return []
      const result = applyPatch(diagramRef.current, ops)
      if (result.applied.length > 0) {
        const flow = toFlow(result.diagram)
        setNodes(flow.nodes)
        setEdges(flow.edges)
        markDirty()
      }
      return result.rejected.map((r) => r.reason)
    },
    [setNodes, setEdges, markDirty],
  )

  // The speech has been arriving on its own channel since before this reply
  // did, so landing a turn is only the drawing and the caption.
  const chatSpeech = useStreamedSpeech()

  const landChatTurn = useCallback(
    (turn: ChatTurn) => {
      const refused = applyOps(turn.ops)
      setChat((c) => (c ? { say: turn.say, busy: false, refused } : c))
    },
    [applyOps],
  )

  const chatSaid = useCallback(
    (said: string) => {
      const refused = chatRef.current?.refused ?? []
      setChat((c) => (c ? { ...c, busy: true } : c))
      window.kaze
        .sayToChat(said, refused)
        .then(landChatTurn)
        .catch((err: Error) => {
          setStatus(err.message)
          setChat((c) => (c ? { ...c, busy: false } : c))
        })
    },
    [landChatTurn],
  )

  // Listed only while the mode is open: enumerating devices is cheap, and the
  // labels are only readable once microphone permission has been granted.
  const mics = useAudioInputs(chat !== null)

  const loop = useVoiceLoop({
    active: chat !== null && !chat.busy && !muted && !chatSpeech.playing,
    force: holding,
    deviceId: mics.deviceId,
    onUtterance: (said) => {
      setChatNote('')
      chatSaid(said)
    },
    onError: setChatNote,
    messages: { denied: t.micDenied, nothing: t.heardNothing, empty: t.recordedNothing },
  })

  // Hold space to talk, inside the mode as well as outside it. The detector is
  // a convenience; this is the guarantee.
  useEffect(() => {
    if (!chat) return
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      e.preventDefault()
      chatSpeech.stop()
      setHolding(true)
    }
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      e.preventDefault()
      setHolding(false)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [chat, chatSpeech])

  const enterChat = useCallback(async () => {
    if (!hasVoiceKey) {
      setStatus(t.chatNoKey)
      return
    }
    setMuted(false)
    setChatNote('')
    setChat({ say: '', busy: true, refused: [] })
    try {
      landChatTurn(await window.kaze.openChat(diagramRef.current))
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err))
      setChat(null)
    }
  }, [hasVoiceKey, landChatTurn, t])

  const exitChat = useCallback(() => {
    chatSpeech.stop()
    setChat(null)
    void window.kaze.closeChat()
  }, [chatSpeech])

  // The device is let go when the mode closes. A microphone light that stays on
  // after you left is a promise the app has broken.
  useEffect(() => {
    if (!chat) loop.release()
  }, [chat, loop.release])

  const mic = usePushToTalk({
    enabled: hasVoiceKey && !streaming && !chat,
    // Same root cause outside the mode: the system default input is not
    // necessarily a microphone.
    deviceId: mics.deviceId,
    onUtterance: (text, intent) => void runTurn(intent, intent === 'ask' ? text : undefined),
    onBargeIn: () => {
      speech.stop()
      if (streaming) void window.kaze.cancelTurn()
    },
    onError: setStatus,
    messages: { denied: t.micDenied, nothing: t.heardNothing, nothingMic: t.heardNothingMic },
  })

  useEffect(() => {
    void window.kaze.hasVoiceKey().then(setHasVoiceKey)
    void window.kaze.getFastMode().then(setFast)
  }, [])

  const toggleFast = useCallback(() => {
    const next = !fast
    setFast(next)
    void window.kaze.setFastMode(next)
    setStatus(next ? t.fastModeOn : t.fastModeOff)
  }, [fast, t])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        void save()
      }
      // Drawing is mouse work; switching panels shouldn't be.
      if ((e.ctrlKey || e.metaKey) && e.key === '1') setTab('inspector')
      if ((e.ctrlKey || e.metaKey) && e.key === '2') setTab('text')
      if ((e.ctrlKey || e.metaKey) && e.key === '3') setTab('review')
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        void runTurn('review')
      }
      if (e.key === 'Escape' && streaming) void window.kaze.cancelTurn()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save, runTurn, streaming])

  /**
   * What it is doing, most transient first. `muted` is a resting state and the
   * others are things happening, so a muted microphone must not hide the fact
   * that it is mid-sentence — muting stops it hearing you, not talking to you.
   */
  /**
   * What it is doing, most immediate first.
   *
   * `hearing` comes before everything because it is the answer to the question
   * you are asking while you talk. `muted` sits near the bottom: it is a
   * resting state, and a muted microphone must not hide the fact that the app
   * is mid-sentence — muting stops it hearing you, not talking to you.
   */
  const chatState: ChatState =
    loop.state === 'hearing'
      ? 'hearing'
      : loop.state === 'transcribing'
        ? 'transcribing'
        : chat?.busy
          ? 'thinking'
          : chatSpeech.playing
            ? 'speaking'
            : muted
              ? 'muted'
              : loop.state === 'off'
                // "Escuchando" was the fallback for everything, including a
                // microphone that had not opened. Saying you are listening
                // when you are not is the exact failure this mode had.
                ? 'opening'
                : 'listening'

  return (
    // Conversation mode is a class, not a different tree: the canvas keeps its
    // instance, its viewport and everything React Flow has measured, and the
    // rails simply stop being drawn. Remounting the canvas to hide a sidebar
    // would refit the diagram in front of you every time you entered.
    <div className={`app${chat ? ' app--chat' : ''}`}>
      <aside className="rail rail--left">
        <div className="rail__section rail__section--scenario">
          <h2 className="rail__title">{t.scenario}</h2>
          <ScenarioPanel
            scenarios={scenarios}
            activeId={scenarioId}
            onSelect={setScenarioId}
            onCreated={(id) => void adoptScenario(id)}
            onNewSession={() => void newSession()}
          />
        </div>
        <div className="rail__section">
          <h2 className="rail__title">{t.boundaries}</h2>
          <div className="chipbar">
            {GROUP_KINDS.map((k) => (
              <button key={k} className="btn btn--ghost" onClick={() => addGroup(k)}>
                + {k}
              </button>
            ))}
          </div>
        </div>
        <div className="rail__section rail__section--grow">
          <h2 className="rail__title">{t.services}</h2>
          <Palette onAdd={(spec) => addService(spec)} />
        </div>
      </aside>

      <main className="canvas" ref={wrapper}>
        <ReactFlow
          nodes={nodes}
          edges={drawnEdges}
          onNodesChange={(c) => {
            onNodesChange(c)
            if (c.some((ch) => ch.type !== 'select' && ch.type !== 'dimensions')) markDirty()
          }}
          onEdgesChange={(c) => {
            onEdgesChange(c)
            markDirty()
          }}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          // Any handle can start or receive a connection, which is what lets
          // one handle per side stand in for a source and a target both.
          connectionMode={ConnectionMode.Loose}
          onDragOver={(e) => {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
          }}
          onDrop={(e) => {
            e.preventDefault()
            const serviceId = e.dataTransfer.getData('application/kaze-service')
            const spec = getService(serviceId)
            if (!spec) return
            addService(spec, screenToFlowPosition({ x: e.clientX, y: e.clientY }))
          }}
          proOptions={{ hideAttribution: false }}
          defaultEdgeOptions={{ animated: false, type: flowEdgeType(view.edgeStyle) }}
        >
          {view.background === 'dots' && (
            <Background variant={BackgroundVariant.Dots} gap={22} size={1.6} color="#c4c7c9" />
          )}
          {view.background === 'grid' && (
            <>
              {/* Two passes: a fine grid, and a heavier one every fifth line, so
                  the canvas reads as graph paper rather than as one flat mesh. */}
              <Background id="fine" variant={BackgroundVariant.Lines} gap={22} lineWidth={1} color="#e8eaed" />
              <Background id="major" variant={BackgroundVariant.Lines} gap={110} lineWidth={1} color="#dadce0" />
            </>
          )}
          <CanvasOptions
            view={view}
            onChange={(next) => {
              setView((v) => ({ ...v, ...next }))
              markDirty()
            }}
            onCopyImage={() => void copyImage()}
            onCopyText={() => void copyText()}
            canCopy={nodes.length > 0}
            onFlipEdges={flipSelectedEdges}
            selectedEdges={selectedEdgeIds.size}
          />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable maskColor="rgba(241,243,244,0.75)" nodeColor="#dadce0" nodeStrokeColor="#9aa0a6" />
        </ReactFlow>
      </main>

      <aside className="rail rail--right">
        <div className="rail__section rail__section--grow">
          <div className="tabs">
            {(
              [
                ['inspector', t.tabInspector],
                ['text', t.tabDesignText],
                ['review', t.tabReview],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                className={`tab ${tab === id ? 'tab--on' : ''}`}
                aria-pressed={tab === id}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
          {/* A node wins when both are somehow selected: you clicked the node
              last, and its panel is the bigger one. */}
          {tab === 'inspector' && (selected || selectedEdges.length === 0) && (
            <Inspector node={selected} onLabel={setLabel} onProps={setProps} onDelete={removeNode} />
          )}
          {tab === 'inspector' && !selected && selectedEdges.length > 0 && (
            <EdgeInspector edges={selectedEdges} onChange={setEdgeText} onDelete={removeEdges} />
          )}
          {tab === 'text' && <DesignText diagram={diagram} onSelect={selectNodes} />}
          {tab === 'review' && (
            <ReviewPanel
              streaming={streaming}
              transcript={transcript}
              ledger={outcome?.ledger ?? null}
              verdict={outcome?.payload?.verdict ?? null}
              revision={outcome?.revision ?? null}
              problem={(outcome?.problem as ReviewProblem | undefined) ?? null}
              onSelect={selectNodes}
              onApplyFix={(entry) => void applyFix(entry)}
              fixing={fixing}
            />
          )}
        </div>
      </aside>

      {chat && (
        <ConversationBar
          state={chatState}
          muted={muted}
          level={loop.level}
          say={chat.say}
          heard={loop.heard}
          note={chatNote}
          listening={loop.state !== 'off'}
          signal={loop.signal}
          inputs={mics.inputs}
          deviceId={mics.deviceId}
          onDevice={mics.choose}
          onToggleMute={() => setMuted((m) => !m)}
          onInterrupt={() => chatSpeech.stop()}
          onExit={exitChat}
        />
      )}

      <Toast message={toast} onDismiss={() => setToast(null)} />

      <footer className="statusbar">
        <button
          className={`btn mic mic--${mic.state}`}
          onMouseDown={() => {
            speech.stop()
            void mic.startManually('review')
          }}
          onMouseUp={() => mic.stopManually()}
          onMouseLeave={() => mic.stopManually()}
          disabled={streaming || !hasVoiceKey}
          title={t.micHint}
        >
          {mic.state === 'recording' ? t.listening : mic.state === 'transcribing' ? t.transcribing : t.holdToTalk}
        </button>
        <button className="btn btn--ghost" onClick={() => void runTurn('review')} disabled={streaming}>
          {streaming ? t.reviewing : t.review}
        </button>
        {/* Next to the button it changes the meaning of, not filed away in a
            menu: it is worth seeing which kind of review you are about to get
            at the moment you ask for one. */}
        <button className="btn btn--ghost" onClick={() => void enterChat()} disabled={streaming} title={t.chatModeHint}>
          {t.chatMode}
        </button>
        <button
          className={`btn btn--ghost fasttoggle${fast ? ' fasttoggle--on' : ''}`}
          onClick={toggleFast}
          aria-pressed={fast}
          title={t.fastModeHint}
        >
          <svg viewBox="0 0 24 24" className="fasttoggle__bolt" aria-hidden focusable="false">
            <path d="M13 2 4.5 13.5H11l-1 8.5L19.5 10H13l1-8Z" />
          </svg>
          {t.fastMode}
        </button>
        {speech.available && (
          <button className="btn btn--ghost" onClick={() => (speech.playing ? speech.stop() : speech.play())}>
            {speech.playing ? `■ ${t.stopPlayback}` : `▶ ${t.replay}`}
          </button>
        )}
        {streaming && (
          <button className="btn btn--ghost" onClick={() => void window.kaze.cancelTurn()}>
            {t.stop}
          </button>
        )}
        <AskPopover disabled={streaming} onAsk={(text) => void runTurn('ask', text)} />
        {!hasVoiceKey && (
          <input
            className="ask"
            type="password"
            aria-label={t.keyLabel}
            autoComplete="off"
            placeholder={t.keyPlaceholder}
            value={keyDraft}
            onChange={(e) => setKeyDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || !keyDraft.trim()) return
              void window.kaze
                .setVoiceKey(keyDraft.trim())
                .then(() => {
                  setKeyDraft('')
                  setHasVoiceKey(true)
                  setStatus(t.voiceEnabled)
                })
                .catch((err: Error) => setStatus(err.message))
            }}
          />
        )}
        <button
          className="btn btn--ghost"
          onClick={() => void save()}
          aria-label={dirty ? t.saveUnsaved : t.save}
        >
          {t.save}
          {dirty && (
            <span className="dot" title={t.unsavedChanges} aria-hidden>
              •
            </span>
          )}
        </button>
        <button className="btn btn--ghost" onClick={() => void snapshot()}>
          {t.snapshot}
        </button>
        {beforeFix && (
          <button className="btn btn--ghost" onClick={undoFix}>
            {t.undo}
          </button>
        )}
        <button className="btn btn--ghost" onClick={() => void load()}>
          {t.reload}
        </button>
        <select
          className="langselect"
          aria-label={t.language}
          value={locale}
          onChange={(e) => setLocale(e.target.value as Locale)}
        >
          {LOCALES.map((l) => (
            <option key={l} value={l}>
              {LOCALE_NAMES[l]}
            </option>
          ))}
        </select>
        <span className="statusbar__count">{t.counts(serviceCount, edges.length)}</span>
        <span className="statusbar__msg" role="status" aria-live="polite">
          {mic.heard ? `“${mic.heard}”` : status}
        </span>
      </footer>
    </div>
  )
}

export default function App() {
  const [locale, setLocale] = useState<Locale | null>(null)

  // The language is resolved before first paint, so the interface never
  // flashes English on its way to Spanish.
  useEffect(() => {
    void window.kaze.getLocale().then(setLocale)
  }, [])

  if (!locale) return null

  return (
    <LocaleProvider initial={locale}>
      <ReactFlowProvider>
        <Canvas />
      </ReactFlowProvider>
    </LocaleProvider>
  )
}
