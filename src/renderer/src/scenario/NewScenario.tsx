import { useEffect, useId, useRef, useState } from 'react'
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
 * A native <dialog> with showModal() rather than a div with a high z-index. The
 * platform then owns the four things a modal has to get right and hand-rolled
 * ones usually don't: focus moves inside on open, Tab is trapped, the
 * background goes inert, and Escape closes. Everything below is the part the
 * platform does not do.
 */
export function NewScenario({ onCreated }: { onCreated: (id: string) => void }) {
  const t = useT()
  const dialog = useRef<HTMLDialogElement>(null)
  const topicField = useRef<HTMLTextAreaElement>(null)
  const titleId = useId()

  const [open, setOpen] = useState(false)
  const [topic, setTopic] = useState('')
  const [difficulty, setDifficulty] = useState(2)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // showModal() is imperative, so open/closed state has to be pushed to the
  // element rather than rendered. Calling it twice throws, hence the guard.
  useEffect(() => {
    const el = dialog.current
    if (!el) return
    if (open && !el.open) {
      el.showModal()
      topicField.current?.focus()
    } else if (!open && el.open) {
      el.close()
    }
  }, [open])

  const close = () => {
    // Closing abandons the request, so stop the turn rather than leaving it to
    // finish into a dialog nobody is looking at.
    if (busy) void window.kaze.cancelScenario()
    setBusy(false)
    setError(null)
    setOpen(false)
  }

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

  return (
    <>
      <div className="scenario__actions">
        <button className="btn btn--ghost btn--small" onClick={() => setOpen(true)}>
          + {t.newScenario}
        </button>
        <button className="linkbtn" onClick={() => void window.kaze.revealScenarios()}>
          {t.openScenarioFolder}
        </button>
      </div>

      <dialog
        ref={dialog}
        className="modal"
        aria-labelledby={titleId}
        // Escape fires `close` directly; this keeps React's state in step.
        onClose={() => setOpen(false)}
        onCancel={(e) => {
          if (busy) e.preventDefault()
        }}
        onClick={(e) => {
          // A click that lands on the dialog element itself is a click on the
          // backdrop: the content sits in a child.
          if (e.target === dialog.current && !busy) close()
        }}
      >
        <form method="dialog" className="modal__panel" onSubmit={(e) => e.preventDefault()}>
          <h2 className="modal__title" id={titleId}>
            {t.newScenario}
          </h2>
          <p className="modal__hint">{t.rubricStaysHidden}</p>

          <label className="field">
            <span>{t.topicLabel}</span>
            <textarea
              ref={topicField}
              className="modal__topic"
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

          {error && <p className="modal__error">{error}</p>}

          <div className="modal__actions">
            <button type="button" className="btn btn--ghost" onClick={close}>
              {t.newScenarioCancel}
            </button>
            <button type="button" className="btn" onClick={() => void create()} disabled={busy || !topic.trim()}>
              {busy && <span className="spinner" aria-hidden />}
              {busy ? t.creatingScenario : t.createScenario}
            </button>
          </div>
        </form>
      </dialog>
    </>
  )
}
