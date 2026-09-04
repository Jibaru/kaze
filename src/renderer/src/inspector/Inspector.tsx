import { getService } from '@shared/services'
import type { NodeProps as ConfigProps } from '@shared/types'
import type { KazeNode } from '../diagram-model'

/**
 * Edits the properties the reviewer will actually argue with. Every field here
 * comes from the service manifest, so adding a review dimension is a manifest
 * change rather than a UI change.
 */
export function Inspector({
  node,
  onLabel,
  onProps,
  onDelete,
}: {
  node: KazeNode | null
  onLabel: (id: string, label: string) => void
  onProps: (id: string, props: ConfigProps) => void
  onDelete: (id: string) => void
}) {
  if (!node) {
    return (
      <div className="inspector inspector--empty">
        <p>Select a node to configure it.</p>
        <p className="inspector__hint">
          What you leave blank is what gets flagged — omissions are findings.
        </p>
      </div>
    )
  }

  if (node.type === 'group') {
    return (
      <div className="inspector">
        <header className="inspector__head">
          <span className="inspector__kind">{node.data.kind}</span>
          <code className="inspector__id">{node.id}</code>
        </header>
        <label className="field">
          <span>Label</span>
          <input value={node.data.label} onChange={(e) => onLabel(node.id, e.target.value)} />
        </label>
        <button className="btn btn--danger" onClick={() => onDelete(node.id)}>
          Delete boundary
        </button>
      </div>
    )
  }

  const spec = getService(node.data.serviceId)
  const props = node.data.props

  const set = (key: string, value: string | boolean) => onProps(node.id, { ...props, [key]: value })

  return (
    <div className="inspector">
      <header className="inspector__head">
        <span className="inspector__kind">{spec?.name ?? node.data.serviceId}</span>
        <code className="inspector__id">{node.id}</code>
      </header>

      <label className="field">
        <span>Label</span>
        <input value={node.data.label} onChange={(e) => onLabel(node.id, e.target.value)} />
      </label>

      {spec?.reviewProps?.map((p) => {
        if (p.kind === 'bool') {
          return (
            <label className="field field--check" key={p.key}>
              <input type="checkbox" checked={props[p.key] === true} onChange={(e) => set(p.key, e.target.checked)} />
              <span>{p.label}</span>
            </label>
          )
        }
        if (p.kind === 'enum') {
          return (
            <label className="field" key={p.key}>
              <span>{p.label}</span>
              <select value={String(props[p.key] ?? '')} onChange={(e) => set(p.key, e.target.value)}>
                <option value="">— not set —</option>
                {p.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </label>
          )
        }
        return (
          <label className="field" key={p.key}>
            <span>{p.label}</span>
            <input
              value={String(props[p.key] ?? '')}
              placeholder={p.placeholder}
              onChange={(e) => set(p.key, e.target.value)}
            />
          </label>
        )
      })}

      {!spec?.reviewProps?.length && <p className="inspector__hint">No configurable properties for this service.</p>}

      <button className="btn btn--danger" onClick={() => onDelete(node.id)}>
        Delete node
      </button>
    </div>
  )
}
