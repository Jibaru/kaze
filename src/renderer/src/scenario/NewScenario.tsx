import { useState } from 'react'
import { useT } from '../i18n/useLocale'

/**
 * Authoring a scenario.
 *
 * Note what this form does not ask for: the rubric. It is what the review
 * grades against and it is hidden on purpose, so a field for it would hand you
 * the answer key and quietly make the exercise worth less. You give a topic; the
 * model writes the brief and the rubric together, and only the app reads the
 * second half back.
 *
 * Inline disclosure rather than a modal: a dialog would need focus trapping,
 * `inert` on the background and an Escape handler to be usable by keyboard, and
 * none of that buys anything over a panel that is simply there.
 */
export function NewScenario({ onCreated }: { onCreated: (id: string) => void }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [topic, setTopic] = useState('')
  const [difficulty, setDifficulty] = useState(2)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const create = async () => {
    if (!topic.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await window.kaze.createScenario(topic.trim(), difficulty)
      if ('error' in result) {
        setError(t.authorFailed[result.error] ?? result.error)
        return
      }
      setTopic('')
      setOpen(false)
      onCreated(result.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <div className="scenario__actions">
        <button className="btn btn--ghost btn--small" onClick={() => setOpen(true)}>
          + {t.newScenario}
        </button>
        <button
          className="linkbtn"
          onClick={() => void window.kaze.revealScenarios()}
          title={t.openScenarioFolder}
        >
          {t.openScenarioFolder}
        </button>
      </div>
    )
  }

  return (
    <div className="newscenario">
      <p className="newscenario__hint">{t.rubricStaysHidden}</p>

      <label className="field">
        <span>{t.topicLabel}</span>
        <textarea
          className="newscenario__topic"
          rows={3}
          value={topic}
          disabled={busy}
          placeholder={t.topicPlaceholder}
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => {
            // Enter alone would fight a multi-line topic.
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void create()
          }}
        />
      </label>

      <label className="field">
        <span>{t.difficulty}</span>
        <select value={difficulty} disabled={busy} onChange={(e) => setDifficulty(Number(e.target.value))}>
          {[1, 2, 3].map((n) => (
            <option key={n} value={n}>
              {t.difficultyLevel(n)}
            </option>
          ))}
        </select>
      </label>

      {error && <p className="newscenario__error">{error}</p>}

      <div className="scenario__actions">
        <button className="btn btn--small" onClick={() => void create()} disabled={busy || !topic.trim()}>
          {busy ? t.creatingScenario : t.createScenario}
        </button>
        <button
          className="btn btn--ghost btn--small"
          onClick={() => {
            setOpen(false)
            setError(null)
          }}
          disabled={busy}
        >
          {t.newScenarioCancel}
        </button>
      </div>
    </div>
  )
}
