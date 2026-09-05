/**
 * kaze-adl: the diagram as text.
 *
 * Serializing what you drew is the easy half. The half that matters is `gaps:` —
 * the omissions. An interviewer attacks the database with no backup policy and
 * the edge with no protocol, and neither is visible in a format that only lists
 * what exists. Those are computed here, by the app, from the manifest's flags —
 * never asked of the model, which would just re-derive them inconsistently.
 */
import { getService } from './services'
import { dict } from './i18n'
import type { Diagram, DiagramNode } from './types'

/**
 * A gap carries its parts rather than a finished sentence, so the same finding
 * can be written in English into `design.md` — which is machine-facing and must
 * not change with the interface language — and read back to the user in theirs.
 */
export interface Gap {
  rule: string
  /** What the gap is about: a described node, an edge, a boundary id. */
  subject: string
  /** One extra fact the sentence needs, such as the AZ a node sits in. */
  extra?: string
  /** Node or edge ids the gap points at, so the UI can highlight them. */
  refs: string[]
}

/** The English rendering, which is what the serialized design records. */
export const gapSentence = (gap: Gap): string =>
  dict('en').gapDetail(gap.rule, gap.subject, gap.extra)

export interface DiagramDiff {
  addedNodes: string[]
  removedNodes: string[]
  addedEdges: string[]
  removedEdges: string[]
  changedProps: string[]
}

/** Any of these props being set counts as a stated backup story. */
export const BACKUP_PROPS = ['backup', 'versioning', 'retention', 'lifecycle']
export const SCALING_PROPS = ['autoscaling', 'concurrency', 'shards', 'capacity']
export const MULTI_AZ_PROPS = ['multi_az']

// ── helpers ───────────────────────────────────────────────────────────────

const parentOf = (diagram: Diagram, id: string): string | undefined =>
  diagram.nodes.find((n) => n.id === id)?.parentId ?? diagram.groups.find((g) => g.id === id)?.parentId

/** Walk up the containment chain looking for a boundary of the given kind. */
function enclosing(diagram: Diagram, nodeId: string, kind: string): string | undefined {
  let current = parentOf(diagram, nodeId)
  const seen = new Set<string>()
  while (current && !seen.has(current)) {
    seen.add(current)
    const group = diagram.groups.find((g) => g.id === current)
    if (!group) return undefined
    if (group.kind === kind) return group.id
    current = group.parentId
  }
  return undefined
}

const isSet = (v: unknown): boolean => v === true || (typeof v === 'string' && v.trim() !== '')

const hasAny = (node: DiagramNode, keys: string[]): boolean => keys.some((k) => isSet(node.props[k]))

/**
 * A gap is only worth raising if the design can answer it. If a service does
 * not model the property the rule asks about, the rule has no business firing:
 * an unclosable finding trains you to ignore findings.
 */
const models = (serviceId: string, keys: string[]): boolean => {
  const props = getService(serviceId)?.reviewProps ?? []
  return props.some((p) => keys.includes(p.key))
}

const describe = (node: DiagramNode): string => {
  const spec = getService(node.serviceId)
  return `${node.id} (${spec?.name ?? node.serviceId}${node.label && node.label !== spec?.name ? ` “${node.label}”` : ''})`
}

// ── gaps ──────────────────────────────────────────────────────────────────

export function computeGaps(diagram: Diagram): Gap[] {
  const gaps: Gap[] = []
  const annotations = new Set(
    diagram.nodes.filter((n) => getService(n.serviceId)?.flags?.annotation).map((n) => n.id),
  )
  /** A line to a note points at a box. It does not connect it to anything. */
  const explains = (e: { from: string; to: string }): boolean =>
    annotations.has(e.from) || annotations.has(e.to)

  const degree = new Map<string, number>()
  for (const e of diagram.edges) {
    if (explains(e)) continue
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1)
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1)
  }

  for (const node of diagram.nodes) {
    const spec = getService(node.serviceId)
    const flags = spec?.flags ?? {}

    // Notes and lifelines explain the diagram; they are not in it. A review
    // that opens by complaining that a note has no connections is a review
    // nobody reads twice.
    if (flags.annotation) continue

    if ((degree.get(node.id) ?? 0) === 0) {
      gaps.push({
        rule: 'unconnected_node',
        subject: describe(node),
        refs: [node.id],
      })
    }

    const az = enclosing(diagram, node.id, 'az')

    if ((flags.statefulStore || flags.needsMultiAz) && !parentOf(diagram, node.id)) {
      gaps.push({
        rule: 'unplaced',
        subject: describe(node),
        refs: [node.id],
      })
    } else if (flags.needsMultiAz && az && models(node.serviceId, MULTI_AZ_PROPS) && !hasAny(node, MULTI_AZ_PROPS)) {
      gaps.push({
        rule: 'single_az',
        subject: describe(node),
        extra: az,
        refs: [node.id],
      })
    }

    if (flags.needsBackup && models(node.serviceId, BACKUP_PROPS) && !hasAny(node, BACKUP_PROPS)) {
      gaps.push({
        rule: 'no_backup',
        subject: describe(node),
        refs: [node.id],
      })
    }

    if (flags.needsScalingPolicy && models(node.serviceId, SCALING_PROPS) && !hasAny(node, SCALING_PROPS)) {
      gaps.push({
        rule: 'no_scaling_policy',
        subject: describe(node),
        refs: [node.id],
      })
    }

    // An actor is not part of the system; drawing one inside a VPC says the
    // user runs in your network, which is never what was meant.
    if (flags.external && parentOf(diagram, node.id)) {
      gaps.push({
        rule: 'actor_inside_boundary',
        subject: describe(node),
        extra: parentOf(diagram, node.id),
        refs: [node.id],
      })
    }

    if (flags.entryPoint && models(node.serviceId, ['tls']) && node.props.tls !== true) {
      gaps.push({
        rule: 'untls_entrypoint',
        subject: describe(node),
        refs: [node.id],
      })
    }
  }

  const nodeIds = new Set(diagram.nodes.map((n) => n.id))
  for (const edge of diagram.edges) {
    // Nor does it carry a protocol: asking for one would be asking about the
    // annotation rather than about the design.
    if (!explains(edge) && !isSet(edge.protocol ?? '')) {
      gaps.push({
        rule: 'untyped_edge',
        subject: `${edge.from} -> ${edge.to}`,
        refs: [edge.id],
      })
    }
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      gaps.push({
        rule: 'dangling_edge',
        subject: `${edge.from} -> ${edge.to}`,
        refs: [edge.id],
      })
    }
  }

  for (const group of diagram.groups) {
    const occupied =
      diagram.nodes.some((n) => n.parentId === group.id) || diagram.groups.some((g) => g.parentId === group.id)
    if (!occupied) {
      gaps.push({
        rule: 'empty_boundary',
        subject: `${group.id} (${group.kind})`,
        refs: [group.id],
      })
    }
  }

  const hasObservability = diagram.nodes.some((n) => getService(n.serviceId)?.category === 'Observability')
  if (diagram.nodes.length > 0 && !hasObservability) {
    gaps.push({
      rule: 'no_observability',
      subject: '',
      refs: [],
    })
  }

  return gaps
}

// ── diff ──────────────────────────────────────────────────────────────────

export function diffDiagrams(prev: Diagram | null, next: Diagram): DiagramDiff {
  if (!prev) {
    return {
      addedNodes: next.nodes.map((n) => `${n.id} ${n.serviceId}`),
      removedNodes: [],
      addedEdges: next.edges.map((e) => `${e.from} -> ${e.to}`),
      removedEdges: [],
      changedProps: [],
    }
  }

  const prevNodes = new Map(prev.nodes.map((n) => [n.id, n]))
  const nextNodes = new Map(next.nodes.map((n) => [n.id, n]))
  const edgeKey = (e: { from: string; to: string }) => `${e.from} -> ${e.to}`
  const prevEdges = new Set(prev.edges.map(edgeKey))
  const nextEdges = new Set(next.edges.map(edgeKey))

  const changedProps: string[] = []
  for (const [id, node] of nextNodes) {
    const before = prevNodes.get(id)
    if (!before) continue
    const keys = new Set([...Object.keys(before.props), ...Object.keys(node.props)])
    for (const key of keys) {
      const a = before.props[key]
      const b = node.props[key]
      if (a !== b) changedProps.push(`${id}.${key}: ${fmtProp(a)} -> ${fmtProp(b)}`)
    }
  }

  return {
    addedNodes: [...nextNodes.values()].filter((n) => !prevNodes.has(n.id)).map((n) => `${n.id} ${n.serviceId}`),
    removedNodes: [...prevNodes.values()].filter((n) => !nextNodes.has(n.id)).map((n) => `${n.id} ${n.serviceId}`),
    addedEdges: [...nextEdges].filter((k) => !prevEdges.has(k)),
    removedEdges: [...prevEdges].filter((k) => !nextEdges.has(k)),
    changedProps,
  }
}

const fmtProp = (v: unknown): string => (v === undefined || v === '' ? 'unset' : String(v))

export const diffIsEmpty = (d: DiagramDiff): boolean =>
  d.addedNodes.length === 0 &&
  d.removedNodes.length === 0 &&
  d.addedEdges.length === 0 &&
  d.removedEdges.length === 0 &&
  d.changedProps.length === 0

// ── serialization ─────────────────────────────────────────────────────────

/** Quote only when a bare scalar would be ambiguous, so the output stays readable. */
function scalar(v: string | boolean | number): string {
  if (typeof v !== 'string') return String(v)
  if (v === '') return '""'
  if (/^[A-Za-z0-9][A-Za-z0-9 ._/@+-]*$/.test(v) && !/^(true|false|null|yes|no|on|off)$/i.test(v)) return v
  return JSON.stringify(v)
}

const inlineMap = (entries: Array<[string, string | boolean | number]>): string =>
  `{ ${entries.map(([k, v]) => `${k}: ${scalar(v)}`).join(', ')} }`

export interface SerializeOptions {
  revision?: number
  diff?: DiagramDiff | null
  /** Omit the gaps section (used when diffing revisions, where it is noise). */
  includeGaps?: boolean
}

export function serialize(diagram: Diagram, options: SerializeOptions = {}): string {
  const { revision, diff, includeGaps = true } = options
  const out: string[] = []

  out.push(`scenario: ${scalar(diagram.scenarioId)}`)
  if (revision !== undefined) out.push(`revision: ${revision}`)

  if (diff && !diffIsEmpty(diff)) {
    out.push('diff_from_previous:')
    const section = (key: string, items: string[]) => {
      if (items.length) out.push(`  ${key}: [${items.map((i) => scalar(i)).join(', ')}]`)
    }
    section('added_nodes', diff.addedNodes)
    section('removed_nodes', diff.removedNodes)
    section('added_edges', diff.addedEdges)
    section('removed_edges', diff.removedEdges)
    section('changed_props', diff.changedProps)
  }

  if (diagram.groups.length) {
    out.push('groups:')
    for (const g of diagram.groups) {
      const entries: Array<[string, string | boolean | number]> = [
        ['id', g.id],
        ['kind', g.kind],
        ['label', g.label],
      ]
      if (g.parentId) entries.push(['parent', g.parentId])
      out.push(`  - ${inlineMap(entries)}`)
    }
  }

  if (diagram.nodes.length) {
    out.push('nodes:')
    for (const n of diagram.nodes) {
      const spec = getService(n.serviceId)
      const entries: Array<[string, string | boolean | number]> = [
        ['id', n.id],
        ['service', n.serviceId],
      ]
      if (n.label && n.label !== spec?.name) entries.push(['label', n.label])
      if (n.parentId) entries.push(['in', n.parentId])
      const props = Object.entries(n.props).filter(([, v]) => isSet(v))
      const head = `  - ${inlineMap(entries)}`
      if (props.length === 0) {
        out.push(head)
      } else {
        out.push(head.replace(/ }$/, `, props: ${inlineMap(props as Array<[string, string | boolean]>)} }`))
      }
    }
  }

  if (diagram.edges.length) {
    out.push('edges:')
    for (const e of diagram.edges) {
      const entries: Array<[string, string | boolean | number]> = [
        ['from', e.from],
        ['to', e.to],
      ]
      if (e.step !== undefined) entries.push(['step', e.step])
      if (e.protocol) entries.push(['protocol', e.protocol])
      if (e.label) entries.push(['label', e.label])
      out.push(`  - ${inlineMap(entries)}`)
    }
  }

  if (includeGaps) {
    const gaps = computeGaps(diagram)
    if (gaps.length) {
      out.push('gaps:')
      for (const g of gaps) out.push(`  - ${g.rule}: ${JSON.stringify(gapSentence(g))}`)
    } else if (diagram.nodes.length) {
      out.push('gaps: []   # nothing obviously omitted — argue about the design itself')
    }
  }

  return out.join('\n') + '\n'
}

/** What gets written to `design.md` and to each revision snapshot. */
export function toDesignDocument(diagram: Diagram, options: SerializeOptions = {}): string {
  return ['```yaml', serialize(diagram, options).trimEnd(), '```', ''].join('\n')
}
