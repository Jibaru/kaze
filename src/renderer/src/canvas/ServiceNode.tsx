import { Handle, Position, type NodeProps } from '@xyflow/react'
import { getService } from '@shared/services'
import { getServiceIcon } from '../service-icons'
import type { ServiceNodeData } from '../diagram-model'

/**
 * A service on the canvas. The chips under the label are the configured
 * review props — they are the difference between a box labelled "RDS" and a
 * design claim, so they are shown, not hidden in an inspector.
 */
export function ServiceNode({ id, data, selected }: NodeProps & { data: ServiceNodeData }) {
  const spec = getService(data.serviceId)
  const Icon = getServiceIcon(data.serviceId)

  const chips = Object.entries(data.props)
    .filter(([, v]) => v !== '' && v !== false)
    .map(([k, v]) => (v === true ? k.replace(/_/g, ' ') : `${k.replace(/_/g, ' ')}: ${v}`))

  return (
    <div className={`node ${selected ? 'node--selected' : ''}`}>
      {/* One handle per side, all declared as sources: the canvas runs in
          loose connection mode, where any handle can start or receive a
          connection. Two overlapping handles per side would be the
          alternative, and they fight each other for the pointer. */}
      <Handle type="source" id="top" position={Position.Top} />
      <Handle type="source" id="left" position={Position.Left} />
      <div className="node__head">
        {Icon ? <Icon className="node__icon" aria-hidden /> : <div className="node__icon node__icon--missing" />}
        <div className="node__titles">
          <div className="node__label">{data.label}</div>
          <div className="node__service">
            {spec?.name ?? data.serviceId} <span className="node__id">{id}</span>
          </div>
        </div>
      </div>
      {chips.length > 0 && (
        <div className="node__chips">
          {chips.map((c) => (
            <span className="chip" key={c}>
              {c}
            </span>
          ))}
        </div>
      )}
      <Handle type="source" id="right" position={Position.Right} />
      <Handle type="source" id="bottom" position={Position.Bottom} />
    </div>
  )
}
