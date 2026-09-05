import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { ServiceNodeData } from '../diagram-model'

/**
 * A note. Its label *is* its text, wrapped.
 *
 * Deliberately not a service node with a `text` property: a note whose content
 * is a form field is a note that gets truncated to one line on the canvas,
 * which is the one thing it must never be. One field, shown at full length,
 * edited where you already edit a label.
 *
 * One handle, on the left, because a note points at something rather than
 * taking part in the flow — and because a note with four attachment points
 * invites being wired into the design, which is what `annotation` exists to
 * keep it out of.
 */
export function NoteNode({ data, selected }: NodeProps & { data: ServiceNodeData }) {
  return (
    <div className={`note ${selected ? 'note--selected' : ''}`}>
      <Handle type="source" id="left" position={Position.Left} />
      <p className="note__text">{data.label}</p>
      <Handle type="source" id="right" position={Position.Right} />
    </div>
  )
}
