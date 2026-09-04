import { useMemo } from 'react'
import { computeGaps, serialize } from '@shared/adl'
import { useT } from '../i18n/useLocale'
import type { Diagram } from '@shared/types'

/**
 * The design exactly as the reviewer will receive it. Showing this is not a
 * debug affordance: if you can see that your diagram serializes to "RDS, one AZ,
 * no backup", you have already learned the lesson before anyone says it aloud.
 */
export function DesignText({ diagram, onSelect }: { diagram: Diagram; onSelect: (ids: string[]) => void }) {
  const t = useT()
  const { text, gaps } = useMemo(
    () => ({ text: serialize(diagram, { includeGaps: false }), gaps: computeGaps(diagram) }),
    [diagram],
  )

  return (
    <div className="designtext">
      <div className="designtext__gaps">
        <h3 className="designtext__heading">
          {t.gaps}
          <span className={`badge ${gaps.length ? 'badge--warn' : 'badge--ok'}`}>{gaps.length}</span>
        </h3>
        {gaps.length === 0 ? (
          <p className="inspector__hint">{t.noGaps}</p>
        ) : (
          <ul className="gaplist">
            {gaps.map((g, i) => (
              <li key={`${g.rule}-${i}`}>
                <button className="gaplist__item" onClick={() => onSelect(g.refs)} disabled={g.refs.length === 0}>
                  <span className="gaplist__rule">{t.gapRule[g.rule] ?? g.rule.replace(/_/g, ' ')}</span>
                  <span className="gaplist__detail">{t.gapDetail(g.rule, g.subject, g.extra)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <h3 className="designtext__heading">{t.whatReviewerReads}</h3>
      <pre className="designtext__code">{text}</pre>
    </div>
  )
}
