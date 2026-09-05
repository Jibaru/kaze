import { useId, useRef } from 'react'
import type { Concept } from '@shared/types'
import { useT } from '../i18n/useLocale'

/**
 * Pick a concept to study.
 *
 * A menu rather than a selector beside the review controls, because starting a
 * lesson is not something you do while designing — it takes the screen. Same
 * native `popover` as the scenario actions, for the same reasons: light
 * dismiss and the top layer come from the platform.
 */
export function LessonMenu({
  concepts,
  onStart,
  disabled,
}: {
  concepts: Concept[]
  onStart: (concept: Concept) => void
  disabled: boolean
}) {
  const t = useT()
  const popover = useRef<HTMLDivElement>(null)
  const id = useId().replace(/[^a-zA-Z0-9-]/g, '')

  return (
    <>
      <button
        className="btn btn--ghost"
        popoverTarget={id}
        disabled={disabled || concepts.length === 0}
        title={concepts.length === 0 ? t.studyEmpty : t.studyHint}
      >
        {t.study}
      </button>

      <div ref={popover} id={id} popover="auto" className="menu menu--wide">
        {concepts.map((c) => (
          <button
            key={c.id}
            className="menu__item menu__item--stacked"
            onClick={() => {
              popover.current?.hidePopover()
              onStart(c)
            }}
          >
            <span className="menu__title">{c.title}</span>
            {/* What it costs you: the number of ideas, not a page count. */}
            <span className="menu__meta">{t.studySteps(c.steps)}</span>
          </button>
        ))}
      </div>
    </>
  )
}
