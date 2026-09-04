import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
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
import type { GroupKind, NodeProps as ConfigProps, ReviewOutcome, Scenario, TurnIntent } from '@shared/types'
import type { ReviewProblem } from '@shared/findings'
import { LOCALE_NAMES, LOCALES, type Locale } from '@shared/i18n'
import { emptyDiagram } from '@shared/types'
import { getService, type ServiceSpec } from '@shared/services'
import { ServiceNode } from './canvas/ServiceNode'
import { GroupNode } from './canvas/GroupNode'
import { Palette } from './palette/Palette'
import { ScenarioPanel } from './scenario/ScenarioPanel'
import { Inspector } from './inspector/Inspector'
import { DesignText } from './review/DesignText'
import { ReviewPanel } from './review/ReviewPanel'
import { usePushToTalk } from './voice/usePushToTalk'
import { useSpokenSummary } from './voice/useSpokenSummary'
import { LocaleProvider, useLocale } from './i18n/useLocale'
import {
  fromFlow,
  GROUP_DEFAULT_SIZE,
  nextGroupId,
  nextNodeId,
  toFlow,
  type KazeEdge,
  type KazeNode,
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
  const [question, setQuestion] = useState('')
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [scenarioId, setScenarioId] = useState('')
  const [hasVoiceKey, setHasVoiceKey] = useState(false)
  const [keyDraft, setKeyDraft] = useState('')
  const [dirty, setDirty] = useState(false)
  const wrapper = useRef<HTMLDivElement>(null)
  const { screenToFlowPosition, fitView } = useReactFlow()
  const nodesInitialized = useNodesInitialized()
  const hasFitted = useRef(false)

  const selected = useMemo(() => nodes.find((n) => n.selected) ?? null, [nodes])
  // The save format is also the review format, so it is derived live rather
  // than only on save — the text panel must never lag the canvas.
  const diagram = useMemo(() => fromFlow(nodes, edges, scenarioId), [nodes, edges, scenarioId])
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
      setEdges((eds) => addEdge({ ...c, id: `e-${c.source}-${c.target}` }, eds))
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

  const mic = usePushToTalk({
    enabled: hasVoiceKey && !streaming,
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
  }, [])

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

  return (
    <div className="app">
      <aside className="rail rail--left">
        <div className="rail__section rail__section--scenario">
          <h2 className="rail__title">{t.scenario}</h2>
          <ScenarioPanel scenarios={scenarios} activeId={scenarioId} onSelect={setScenarioId} />
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
          edges={edges}
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
          defaultEdgeOptions={{ animated: false }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color="#dadce0" />
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
          {tab === 'inspector' && (
            <Inspector node={selected} onLabel={setLabel} onProps={setProps} onDelete={removeNode} />
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
            />
          )}
        </div>
      </aside>

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
        <input
          className="ask"
          aria-label={t.askLabel}
          placeholder={t.askPlaceholder}
          value={question}
          disabled={streaming}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || !question.trim()) return
            void runTurn('ask', question.trim())
            setQuestion('')
          }}
        />
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
