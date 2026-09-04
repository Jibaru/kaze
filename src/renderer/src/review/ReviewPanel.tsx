import { useState } from 'react'
import { openEntries, resolvedEntries, sortEntries, type Ledger, type LedgerEntry } from '@shared/ledger'

const VERDICT_LABEL: Record<string, string> = {
  solid: 'Solid',
  needs_work: 'Needs work',
  does_not_meet_brief: 'Does not meet the brief',
}

const STATUS_LABEL: Record<string, string> = {
  new: 'new',
  open: 'still open',
  regressed: 'regressed',
  resolved: 'fixed',
}

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
  problem: string | null
  onSelect: (ids: string[]) => void
}) {
  const [showTranscript, setShowTranscript] = useState(false)

  if (!streaming && !transcript && !ledger) {
    return (
      <div className="inspector inspector--empty">
        <p>No review yet.</p>
        <p className="inspector__hint">
          Draw a design, then ask for a review. Each one is a numbered revision, so the next review can
          tell you whether what you changed actually worked.
        </p>
      </div>
    )
  }

  const open = ledger ? sortEntries(openEntries(ledger)) : []
  const fixed = ledger ? resolvedEntries(ledger) : []

  return (
    <div className="reviewpanel">
      {verdict && (
        <div className={`verdict verdict--${verdict}`}>
          <span className="verdict__label">{VERDICT_LABEL[verdict] ?? verdict}</span>
          {revision !== null && <span className="verdict__rev">revision {revision}</span>}
        </div>
      )}

      {problem && <p className="notice">{problem}</p>}

      {fixed.length > 0 && <FixedStrip entries={fixed} onSelect={onSelect} />}

      {open.length > 0 && (
        <ul className="findings">
          {open.map((entry) => (
            <li key={entry.id}>
              <FindingRow entry={entry} onSelect={onSelect} />
            </li>
          ))}
        </ul>
      )}

      <button
        className="disclose"
        aria-expanded={showTranscript || streaming}
        onClick={() => setShowTranscript((v) => !v)}
      >
        {showTranscript ? '▾' : '▸'} Transcript {streaming && <span className="pulse" aria-label="streaming" />}
      </button>
      {(showTranscript || streaming) && <div className="transcript">{transcript || '…'}</div>}
    </div>
  )
}

/** Fixed findings collapse: the win is worth seeing, the detail is not. */
function FixedStrip({ entries, onSelect }: { entries: LedgerEntry[]; onSelect: (ids: string[]) => void }) {
  const [expanded, setExpanded] = useState(false)
  const declared = entries.filter((e) => e.resolvedBy === 'declared').length

  return (
    <div className="fixed">
      <button className="fixed__head" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
        {expanded ? '▾' : '▸'} Fixed ({entries.length})
        {declared < entries.length && (
          <span className="fixed__note">{entries.length - declared} no longer raised</span>
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
                    ? `fixed in revision ${e.resolvedAtRevision}`
                    : `no longer raised as of revision ${e.resolvedAtRevision}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function FindingRow({ entry, onSelect }: { entry: LedgerEntry; onSelect: (ids: string[]) => void }) {
  const age = entry.lastSeenRevision - entry.firstSeenRevision

  return (
    <button
      className={`finding finding--${entry.severity} finding--status-${entry.status}`}
      onClick={() => onSelect(entry.nodes)}
      disabled={entry.nodes.length === 0}
    >
      <span className="finding__meta">
        <span className={`finding__status finding__status--${entry.status}`}>{STATUS_LABEL[entry.status]}</span>
        <span className="finding__severity">{entry.severity}</span>
        <span className="finding__pillar">{entry.pillar}</span>
        {entry.bp_id && <span className="finding__bp">{entry.bp_id}</span>}
        {entry.nodes.length > 0 && <span className="finding__nodes">{entry.nodes.join(' ')}</span>}
        {age > 0 && <span className="finding__age">unfixed for {age} revision{age === 1 ? '' : 's'}</span>}
      </span>
      <span className="finding__claim">{entry.claim}</span>
      {entry.fix && <span className="finding__fix">{entry.fix}</span>}
    </button>
  )
}
