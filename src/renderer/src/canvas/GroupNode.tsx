import { NodeResizer, type NodeProps } from '@xyflow/react'
import type { GroupNodeData } from '../diagram-model'

/**
 * A boundary: account, region, VPC, AZ or subnet. Containment is real data —
 * "this database sits in one AZ" is a finding the serializer derives from a
 * node's parent group, not from where the box happens to look.
 */
export function GroupNode({ data, selected }: NodeProps & { data: GroupNodeData }) {
  return (
    <div className={`group group--${data.kind} ${selected ? 'group--selected' : ''}`}>
      <NodeResizer minWidth={200} minHeight={140} isVisible={selected} lineClassName="group__resize" handleClassName="group__handle" />
      <div className="group__tag">
        <span className="group__kind">{data.kind}</span>
        <span className="group__label">{data.label}</span>
      </div>
    </div>
  )
}
