import { Handle, Position, type NodeProps } from '@xyflow/react'
import { getService } from '@shared/services'
import { getServiceIcon } from '../service-icons'
import { LIFELINE_SLOTS } from '../diagram-model'
import type { ServiceNodeData } from '../diagram-model'

/**
 * A column in a sequence diagram: a header, and a long dashed line under it.
 *
 * The handles are the point. An ordinary node has four, one per side, and a
 * connection picks the side that faces the other box. A lifeline has one pair
 * per step down its whole length, so a message numbered 3 attaches at the third
 * row on both columns and the vertical position *is* the order.
 *
 * That is the one thing a box-and-arrow diagram cannot say, and the reason
 * sequence diagrams exist: a cold start, a retry with backoff and a cascading
 * timeout are all about *when*, and every one of them is invisible on a
 * component diagram.
 */
const SLOT_TOP = 64
const SLOT_GAP = 42

export function LifelineNode({ id, data, selected }: NodeProps & { data: ServiceNodeData }) {
  const spec = getService(data.serviceId)
  const Icon = getServiceIcon(data.serviceId)
  const role = typeof data.props.role === 'string' ? data.props.role : ''

  return (
    <div className={`lifeline ${selected ? 'lifeline--selected' : ''}`}>
      <div className="lifeline__head">
        {Icon && <Icon className="node__icon" aria-hidden />}
        <div className="node__titles">
          <div className="node__label">{data.label}</div>
          <div className="node__service">
            {role || spec?.name} <span className="node__id">{id}</span>
          </div>
        </div>
      </div>

      {/* One handle per step, on the line itself rather than at the edge of
          the box. A message has to start and end *on* the lifeline or it reads
          as an arrow floating between two columns.

          One, not one per side: the canvas runs in loose connection mode, so
          the same handle can start a message and receive one — which is also
          why a slot never has two handles fighting for the pointer. */}
      <div className="lifeline__body" aria-hidden>
        {Array.from({ length: LIFELINE_SLOTS }, (_, i) => (
          <span key={i}>
            <Handle
              type="source"
              id={`s${i + 1}`}
              position={Position.Left}
              style={{ top: SLOT_TOP + i * SLOT_GAP, left: '50%' }}
            />
            {/* The outside edge, for a message from this lifeline to itself:
                both ends are the same point on the line, so a self-call has to
                leave the column and come back. */}
            <Handle
              type="source"
              id={`o${i + 1}`}
              position={Position.Right}
              style={{ top: SLOT_TOP + i * SLOT_GAP }}
            />
          </span>
        ))}
      </div>
    </div>
  )
}
