import { useId, useRef } from 'react'
import { useT } from '../i18n/useLocale'

/**
 * The scenario actions, folded away.
 *
 * They were three controls sitting permanently above the brief, which is a lot
 * of furniture for things you press once a session — and the brief is what you
 * actually read. A native `popover` again: the platform supplies light dismiss
 * and the top layer, and anchor positioning ties it to its button.
 *
 * Deliberately not `role="menu"`. That role is a promise about arrow-key
 * navigation and typeahead, and a promise not kept is worse than none: a screen
 * reader would announce a menu that does not behave like one. Three buttons in
 * a popover are reached with Tab, which is what they are.
 */
export function ScenarioMenu({
  onNewScenario,
  onNewSession,
}: {
  onNewScenario: () => void
  onNewSession: () => void
}) {
  const t = useT()
  const popover = useRef<HTMLDivElement>(null)
  const id = useId().replace(/[^a-zA-Z0-9-]/g, '')

  const run = (action: () => void) => {
    popover.current?.hidePopover()
    action()
  }

  return (
    <>
      <button className="iconbtn scenariomenu__trigger" popoverTarget={id} aria-label={t.scenarioActions} title={t.scenarioActions}>
        <svg viewBox="0 0 24 24" aria-hidden focusable="false">
          <circle cx="12" cy="5" r="1.9" fill="currentColor" />
          <circle cx="12" cy="12" r="1.9" fill="currentColor" />
          <circle cx="12" cy="19" r="1.9" fill="currentColor" />
        </svg>
      </button>

      <div ref={popover} id={id} popover="auto" className="menu">
        <button className="menu__item" onClick={() => run(onNewScenario)}>
          {t.newScenario}…
        </button>
        <button className="menu__item" onClick={() => run(() => void window.kaze.revealScenarios())}>
          {t.openScenarioFolder}
        </button>
        <span className="menu__sep" aria-hidden />
        {/* Archives the attempt, so it is kept apart from the two above it. */}
        <button className="menu__item" onClick={() => run(onNewSession)}>
          {t.newSession}
        </button>
      </div>
    </>
  )
}
