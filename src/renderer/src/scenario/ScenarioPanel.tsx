import type { Scenario } from '@shared/types'
import { useT } from '../i18n/useLocale'
import { NewScenario } from './NewScenario'

/**
 * The brief you are designing against. The scenario's rubric is stripped in the
 * main process, so there is nothing here to accidentally read ahead.
 */
export function ScenarioPanel({
  scenarios,
  activeId,
  onSelect,
  onCreated,
}: {
  scenarios: Scenario[]
  activeId: string
  onSelect: (id: string) => void
  /** A scenario was just written; reload the bank and switch to it. */
  onCreated: (id: string) => void
}) {
  const t = useT()
  const active = scenarios.find((s) => s.id === activeId)

  if (scenarios.length === 0) {
    return (
      <div className="scenario">
        <p className="inspector__hint">{t.noScenarios}</p>
        <NewScenario onCreated={onCreated} />
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
      <NewScenario onCreated={onCreated} />
      {active && <div className="scenario__brief">{renderBrief(active.brief)}</div>}
    </div>
  )
}

/**
 * The brief is short, structured markdown written by us. A heading/bullet
 * renderer covers it; pulling in a markdown library to render our own file
 * would be paying for generality we control.
 */
function renderBrief(brief: string) {
  return brief.split('\n').map((line, i) => {
    const heading = /^#{2,3}\s+(.*)$/.exec(line)
    if (heading) {
      return (
        <h4 className="scenario__heading" key={i}>
          {heading[1]}
        </h4>
      )
    }
    const bullet = /^[-*]\s+(.*)$/.exec(line)
    if (bullet) {
      return (
        <p className="scenario__bullet" key={i}>
          {bullet[1]}
        </p>
      )
    }
    if (line.trim() === '') return null
    return (
      <p className="scenario__text" key={i}>
        {line}
      </p>
    )
  })
}
