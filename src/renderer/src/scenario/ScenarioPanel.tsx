import type { Scenario } from '@shared/types'
import { useT } from '../i18n/useLocale'
import { NewScenario } from './NewScenario'
import { Markdown } from '../markdown/Markdown'

/**
 * The brief you are designing against. The scenario's rubric is stripped in the
 * main process, so there is nothing here to accidentally read ahead.
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
  const active = scenarios.find((s) => s.id === activeId)

  if (scenarios.length === 0) {
    return (
      <div className="scenario">
        <p className="inspector__hint">{t.noScenarios}</p>
        <NewScenario onCreated={onCreated} onNewSession={onNewSession} />
      </div>
    )
  }

  return (
    <div className="scenario">
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
      <NewScenario onCreated={onCreated} onNewSession={onNewSession} />
      {active && <Markdown className="scenario__brief">{active.brief}</Markdown>}
    </div>
  )
}

