import { useState } from 'react'
import { openEntries, resolvedEntries, sortEntries, type Ledger, type LedgerEntry } from '@shared/ledger'
import type { ReviewProblem } from '@shared/findings'
import type { Dict } from '@shared/i18n'
import { useT } from '../i18n/useLocale'

const verdictLabel = (t: Dict, verdict: string): string =>
  ({ solid: t.verdictSolid, needs_work: t.verdictNeedsWork, does_not_meet_brief: t.verdictDoesNotMeet })[
    verdict
  ] ?? verdict

const statusLabel = (t: Dict, status: string): string =>
  ({ new: t.statusNew, open: t.statusOpen, regressed: t.statusRegressed, resolved: t.statusFixed })[
    status
  ] ?? status

const problemLabel = (t: Dict, problem: ReviewProblem): string =>
  problem === 'no-block' ? t.noFindingsBlock : t.notAPayload

/**
 * The review as a ledger rather than a list. Watching "single point of failure
 * at the DB tier" go from red to struck-through across revisions is the entire
 * point of reviewing continuously; a fresh anonymous list every time would make
 * review #4 indistinguishable from review #1.
 */
export function ReviewPanel({
  streaming,
  transcript,
  ledger,
  verdict,
  revision,
  problem,
  onSelect,
}: {
  streaming: boolean
  transcript: string
  ledger: Ledger | null
  verdict: string | null
  revision: number | null
  problem: ReviewProblem | null
  onSelect: (ids: string[]) => void
}) {
  const t = useT()
  const [showTranscript, setShowTranscript] = useState(false)

  if (!streaming && !transcript && !ledger) {
    return (
      <div className="inspector inspector--empty">
        <p>{t.noReview}</p>
        <p className="inspector__hint">{t.noReviewHint}</p>
      </div>
    )
  }

  const open = ledger ? sortEntries(openEntries(ledger)) : []
  const fixed = ledger ? resolvedEntries(ledger) : []

  return (
    <div className="reviewpanel">
      {verdict && (
        <div className={`verdict verdict--${verdict}`}>
          <span className="verdict__label">{verdictLabel(t, verdict)}</span>
          {revision !== null && <span className="verdict__rev">{t.revisionN(revision)}</span>}
        </div>
      )}

      {problem && <p className="notice">{problemLabel(t, problem)}</p>}

      {fixed.length > 0 && <FixedStrip entries={fixed} onSelect={onSelect} t={t} />}

      {open.length > 0 && (
        <ul className="findings">
          {open.map((entry) => (
            <li key={entry.id}>
              <FindingRow entry={entry} onSelect={onSelect} t={t} />
            </li>
          ))}
        </ul>
      )}

      <button
        className="disclose"
        aria-expanded={showTranscript || streaming}
        onClick={() => setShowTranscript((v) => !v)}
      >
        {showTranscript ? '▾' : '▸'} {t.transcript}{' '}
        {streaming && <span className="pulse" aria-label={t.reviewing} />}
      </button>
      {(showTranscript || streaming) && <div className="transcript">{transcript || '…'}</div>}
    </div>
  )
}

/** Fixed findings collapse: the win is worth seeing, the detail is not. */
function FixedStrip({ entries, onSelect, t }: { entries: LedgerEntry[]; onSelect: (ids: string[]) => void; t: Dict }) {
  const [expanded, setExpanded] = useState(false)
  const declared = entries.filter((e) => e.resolvedBy === 'declared').length

  return (
    <div className="fixed">
      <button className="fixed__head" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
        {expanded ? '▾' : '▸'} {t.fixedCount(entries.length)}
        {declared < entries.length && (
          <span className="fixed__note">{t.noLongerRaisedCount(entries.length - declared)}</span>
        )}
      </button>
      {expanded && (
        <ul className="fixed__list">
          {entries.map((e) => (
            <li key={e.id}>
              <button className="fixed__item" onClick={() => onSelect(e.nodes)} disabled={e.nodes.length === 0}>
                <span className="fixed__claim">{e.claim}</span>
                <span className="fixed__meta">
                  {e.resolvedBy === 'declared'
                    ? t.fixedInRevision(e.resolvedAtRevision ?? 0)
                    : t.noLongerRaisedAt(e.resolvedAtRevision ?? 0)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function FindingRow({ entry, onSelect, t }: { entry: LedgerEntry; onSelect: (ids: string[]) => void; t: Dict }) {
  const age = entry.lastSeenRevision - entry.firstSeenRevision

  return (
    <button
      className={`finding finding--${entry.severity} finding--status-${entry.status}`}
      onClick={() => onSelect(entry.nodes)}
      disabled={entry.nodes.length === 0}
    >
      <span className="finding__meta">
        <span className={`finding__status finding__status--${entry.status}`}>{statusLabel(t, entry.status)}</span>
        <span className="finding__severity">{entry.severity}</span>
        <span className="finding__pillar">{entry.pillar}</span>
        {entry.bp_id && <span className="finding__bp">{entry.bp_id}</span>}
        {entry.nodes.length > 0 && <span className="finding__nodes">{entry.nodes.join(' ')}</span>}
        {age > 0 && <span className="finding__age">{t.unfixedFor(age)}</span>}
      </span>
      <span className="finding__claim">{entry.claim}</span>
      {entry.fix && <span className="finding__fix">{entry.fix}</span>}
    </button>
  )
}
