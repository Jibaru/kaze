/**
 * The findings ledger.
 *
 * Continuous feedback only means anything if a finding has an identity that
 * survives across reviews — otherwise review #4 is review #1 with more words.
 * The app owns that identity, not the model: the model's `id` is a hint it is
 * asked to keep stable, and usually does, but a review is regenerated prose and
 * cannot be trusted as a primary key.
 *
 * Two failure modes, both lies, and they pull in opposite directions:
 *
 *   - Over-merging collapses two distinct findings into one, and the second
 *     silently disappears.
 *   - Under-merging marks the old finding resolved when it was only rephrased,
 *     so you get told you fixed something you did not.
 *
 * Matching therefore demands agreement on the pillar AND the nodes AND the
 * wording before merging, and a resolution records *how* it was concluded, so
 * "the model said you fixed this" is never rendered the same as "the model
 * stopped mentioning it".
 */
import type { Finding, ReviewPayload } from './findings'
import { similarity } from './text'

export type FindingStatus = 'new' | 'open' | 'resolved' | 'regressed'

export interface LedgerEntry extends Finding {
  status: FindingStatus
  firstSeenRevision: number
  lastSeenRevision: number
  resolvedAtRevision: number | null
  /** How the resolution was concluded. `not-raised` is weaker evidence. */
  resolvedBy: 'declared' | 'not-raised' | null
}

export interface Ledger {
  revision: number
  entries: LedgerEntry[]
}

export { similarity }

export const emptyLedger = (): Ledger => ({ revision: 0, entries: [] })

const SIMILARITY_THRESHOLD = 0.3

function nodesOverlap(a: string[], b: string[]): boolean {
  // Two design-wide findings can still be the same finding.
  if (a.length === 0 && b.length === 0) return true
  return a.some((n) => b.includes(n))
}

/**
 * Is this incoming finding the same problem as this ledger entry?
 * Returns a score, or null when they are not the same finding at all.
 */
function matchScore(entry: LedgerEntry, finding: Finding): number | null {
  if (entry.id === finding.id) return 1
  if (entry.pillar !== finding.pillar) return null
  if (!nodesOverlap(entry.nodes, finding.nodes)) return null
  const score = similarity(entry.claim, finding.claim)
  return score >= SIMILARITY_THRESHOLD ? score : null
}

/**
 * Fold one review's payload into the ledger.
 *
 * Every previous entry is matched at most once, best score first, so two
 * incoming findings can never both claim the same history.
 */
export function reconcile(previous: Ledger | null, payload: ReviewPayload, revision: number): Ledger {
  const before = previous?.entries ?? []
  const claimed = new Set<string>()
  const declaredResolved = new Set(payload.resolved)
  const entries: LedgerEntry[] = []

  // Score every pairing first, then assign greedily by score. Taking the first
  // adequate match instead would let finding order decide the history.
  const pairs: Array<{ finding: Finding; entry: LedgerEntry; score: number }> = []
  for (const finding of payload.findings) {
    for (const entry of before) {
      const score = matchScore(entry, finding)
      if (score !== null) pairs.push({ finding, entry, score })
    }
  }
  pairs.sort((a, b) => b.score - a.score)

  const matchedFinding = new Map<Finding, LedgerEntry>()
  for (const { finding, entry } of pairs) {
    if (matchedFinding.has(finding) || claimed.has(entry.id)) continue
    matchedFinding.set(finding, entry)
    claimed.add(entry.id)
  }

  for (const finding of payload.findings) {
    const prior = matchedFinding.get(finding)
    if (!prior) {
      entries.push({
        ...finding,
        status: 'new',
        firstSeenRevision: revision,
        lastSeenRevision: revision,
        resolvedAtRevision: null,
        resolvedBy: null,
      })
      continue
    }
    entries.push({
      ...finding,
      // Keep the id the ledger already knows: the UI and the user have been
      // looking at it, and the model may have renamed it.
      id: prior.id,
      status: prior.status === 'resolved' ? 'regressed' : 'open',
      firstSeenRevision: prior.firstSeenRevision,
      lastSeenRevision: revision,
      resolvedAtRevision: null,
      resolvedBy: null,
    })
  }

  // Anything the review did not raise again.
  for (const entry of before) {
    if (claimed.has(entry.id)) continue
    if (entry.status === 'resolved') {
      entries.push(entry)
      continue
    }
    entries.push({
      ...entry,
      status: 'resolved',
      resolvedAtRevision: revision,
      resolvedBy: declaredResolved.has(entry.id) ? 'declared' : 'not-raised',
    })
  }

  return { revision, entries }
}

const STATUS_ORDER: Record<FindingStatus, number> = { regressed: 0, new: 1, open: 2, resolved: 3 }
const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 } as const

/** Regressions first — a finding you already fixed coming back is the loudest signal. */
export function sortEntries(entries: LedgerEntry[]): LedgerEntry[] {
  return [...entries].sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  )
}

export const openEntries = (ledger: Ledger): LedgerEntry[] =>
  ledger.entries.filter((e) => e.status !== 'resolved')

export const resolvedEntries = (ledger: Ledger): LedgerEntry[] =>
  ledger.entries.filter((e) => e.status === 'resolved')
