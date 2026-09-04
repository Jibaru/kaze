import { useEffect, useRef, useState } from 'react'
import { useT } from '../i18n/useLocale'

/**
 * Asking a question, behind a button.
 *
 * It used to be a permanent input in the status bar, where it read as chrome
 * and was easy to miss entirely. A button says there is something to do; the
 * field appears when you mean to use it.
 *
 * Native `popover`, not a hand-built dropdown. The platform gives light
 * dismiss — Escape and a click outside — and the top layer, so it cannot be
 * clipped by the status bar it grows out of. Anchor positioning ties it to the
 * button without measuring anything in JavaScript.
 *
 * A popover rather than a dialog on purpose: asking a question should not take
 * the whole window hostage the way `showModal()` does.
 */
export function AskPopover({ onAsk, disabled }: { onAsk: (question: string) => void; disabled: boolean }) {
  const t = useT()
  const popover = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const field = useRef<HTMLInputElement>(null)
  const heldFocus = useRef(false)
  const [question, setQuestion] = useState('')

  useEffect(() => {
    const el = popover.current
    if (!el) return

    const onToggle = (e: Event) => {
      if ((e as ToggleEvent).newState === 'open') {
        // The field is why the popover exists, so put the caret in it.
        field.current?.focus()
        return
      }

      // Escape closes the popover but, unlike <dialog>, does not put focus
      // back, leaving a keyboard user on <body> with no position at all.
      //
      // The check has to straddle the event: at `toggle` time focus is still
      // inside the popover, and Chromium only drops it to <body> afterwards.
      // Reading `activeElement` here answers "did this popover have focus";
      // reading it a frame later answers "did anything else claim it". Both
      // are needed, so that dismissing the popover by clicking another control
      // does not yank focus off whatever was just clicked.
      heldFocus.current = el.contains(document.activeElement)
      if (!heldFocus.current) return
      requestAnimationFrame(() => {
        if (document.activeElement === document.body) trigger.current?.focus()
      })
    }

    el.addEventListener('toggle', onToggle)
    return () => el.removeEventListener('toggle', onToggle)
  }, [])

  const submit = () => {
    const text = question.trim()
    if (!text) return
    onAsk(text)
    setQuestion('')
    popover.current?.hidePopover()
  }

  return (
    <>
      <button
        ref={trigger}
        className="btn btn--ghost ask-trigger"
        popoverTarget="ask-popover"
        disabled={disabled}
        aria-label={t.askLabel}
      >
        {t.askButton}
      </button>

      <div ref={popover} id="ask-popover" popover="auto" className="askpop">
        <input
          ref={field}
          className="askpop__field"
          aria-label={t.askLabel}
          placeholder={t.askPlaceholder}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
        />
        <p className="askpop__hint">{t.askHint}</p>
      </div>
    </>
  )
}
