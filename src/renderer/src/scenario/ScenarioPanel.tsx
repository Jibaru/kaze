import { useState } from 'react'
import type { Scenario } from '@shared/types'
import { useT } from '../i18n/useLocale'
import { NewScenario } from './NewScenario'
import { ScenarioMenu } from './ScenarioMenu'
import { Markdown } from '../markdown/Markdown'

/**
 * The brief you are designing against. The scenario's rubric is stripped in the
 * main process, so there is nothing here to accidentally read ahead.
 *
 * The selector stays on the surface and the actions fold into a menu: which
 * brief you are answering is the identity of the session and worth a glance at
 * any moment, while creating one or starting over happens once and does not
 * need to hold rail space in between. The brief is what you actually read, and
 * it gets the room the three buttons used to take.
 */
export function ScenarioPanel({
  scenarios,
  activeId,
  onSelect,
  onCreated,
  onNewSession,
}: {
  scenarios: Scenario[]
  activeId: string
  onSelect: (id: string) => void
  /** A scenario was just written; reload the bank and switch to it. */
  onCreated: (id: string) => void
  onNewSession: () => void
}) {
  const t = useT()
  const [authoring, setAuthoring] = useState(false)
  const active = scenarios.find((s) => s.id === activeId)

  return (
    <div className="scenario">
      <div className="scenario__head">
        {scenarios.length > 0 ? (
          <select
            className="scenario__select"
            aria-label={t.scenarioLabel}
            value={activeId}
            onChange={(e) => onSelect(e.target.value)}
          >
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        ) : (
          // The menu is how you get a scenario, so it has to stay reachable
          // when there are none.
          <p className="inspector__hint scenario__empty">{t.noScenarios}</p>
        )}

        <ScenarioMenu onNewScenario={() => setAuthoring(true)} onNewSession={onNewSession} />
      </div>

      <NewScenario open={authoring} onOpenChange={setAuthoring} onCreated={onCreated} />

      {active && <Markdown className="scenario__brief">{active.brief}</Markdown>}
    </div>
  )
}
