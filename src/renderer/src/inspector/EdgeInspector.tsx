import { useId } from 'react'
import type { KazeEdge } from '../diagram-model'
import { useT } from '../i18n/useLocale'

/**
 * Edits what a connection says.
 *
 * The app has been raising `untyped_edge` — "connection with no protocol" — on
 * every line since the first review, and until now the only thing that could
 * close it was the model, through an autofix. Asking a question you have not
 * given the person any way to answer is the worst kind of feedback.
 *
 * `protocol` is the one the reviewer argues with, so it gets suggestions: a
 * `<datalist>`, which is the rare native control that is a menu and a text
 * field at once — pick HTTPS, or type "Kafka (3 particiones)" and keep going.
 * The list is vocabulary, not translation, and stays in English for the same
 * reason the service names do.
 *
 * Edits apply to every selected connection. Drawing four lines and calling them
 * all HTTPS is the common case, and the flip button already works this way; a
 * field whose selected edges disagree shows empty with a placeholder rather
 * than silently picking one of them to display.
 */
const PROTOCOLS = [
  'HTTPS',
  'HTTP',
  'gRPC',
  'WebSocket',
  'TCP',
  'SQL',
  'Redis',
  'DynamoDB API',
  'S3 API',
  'SQS',
  'Kinesis',
  'Kafka',
  'AMQP',
  'MQTT',
  'DNS',
]

export function EdgeInspector({
  edges,
  onChange,
  onDelete,
}: {
  /** Every selected connection. Never empty — the caller decides that. */
  edges: KazeEdge[]
  onChange: (ids: string[], patch: { protocol?: string; label?: string }) => void
  onDelete: (ids: string[]) => void
}) {
  const t = useT()
  const listId = useId().replace(/[^a-zA-Z0-9-]/g, '')
  const ids = edges.map((e) => e.id)

  /** The shared value, or '' when they disagree — the usual mixed state. */
  const shared = (read: (e: KazeEdge) => string) => {
    const first = read(edges[0]!)
    return edges.every((e) => read(e) === first) ? first : ''
  }
  const mixed = (read: (e: KazeEdge) => string) =>
    edges.length > 1 && !edges.every((e) => read(e) === read(edges[0]!))

  const protocol = (e: KazeEdge) => e.data?.protocol ?? ''
  const label = (e: KazeEdge) => e.data?.label ?? ''

  return (
    <div className="inspector">
      <header className="inspector__head">
        <span className="inspector__kind">
          {edges.length === 1 ? t.connection : t.connections(edges.length)}
        </span>
        {edges.length === 1 && (
          // Which way it goes, at the moment you are naming what flows along
          // it. The arrow on the canvas says the same thing, smaller.
          <code className="inspector__id">
            {edges[0]!.source} → {edges[0]!.target}
          </code>
        )}
      </header>

      <label className="field">
        <span>{t.protocol}</span>
        <input
          list={listId}
          value={shared(protocol)}
          placeholder={mixed(protocol) ? t.mixedValues : t.protocolPlaceholder}
          onChange={(e) => onChange(ids, { protocol: e.target.value })}
        />
        <datalist id={listId}>
          {PROTOCOLS.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </label>
      {/* Only while it is still open. Once you have answered it, repeating the
          question is noise. */}
      {!shared(protocol) && <p className="inspector__hint">{t.protocolHint}</p>}

      <label className="field">
        <span>{t.edgeLabel}</span>
        <input
          value={shared(label)}
          placeholder={mixed(label) ? t.mixedValues : t.edgeLabelPlaceholder}
          onChange={(e) => onChange(ids, { label: e.target.value })}
        />
      </label>

      <button className="btn btn--danger" onClick={() => onDelete(ids)}>
        {edges.length === 1 ? t.deleteConnection : t.deleteConnections(edges.length)}
      </button>
    </div>
  )
}
