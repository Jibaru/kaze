import { useEffect, useRef } from 'react'

/**
 * A confirmation you cannot miss.
 *
 * These used to land in the status bar, which is the right place for ongoing
 * state — "Revisando…", the cost of the last turn — and the wrong place for a
 * thing that just happened: it sits in the corner, it does not move, and you
 * were looking at the canvas.
 *
 * `role="status"` announces it once, politely. The status bar keeps its own
 * live region for progress, and the actions that raise a toast deliberately do
 * not also write there, or a screen reader would hear the same thing twice.
 */
export function Toast({ message, onDismiss }: { message: string | null; onDismiss: () => void }) {
  const timer = useRef<number | null>(null)

  useEffect(() => {
    if (!message) return
    // A new message replaces the old one rather than queueing behind it: these
    // confirm the last thing you did, and the last thing is the one you care
    // about.
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(onDismiss, 3600)
    return () => {
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [message, onDismiss])

  if (!message) return null

  return (
    <div className="toast" role="status" aria-live="polite">
      <span className="toast__text">{message}</span>
      <button className="toast__close" onClick={onDismiss} aria-label="OK">
        OK
      </button>
    </div>
  )
}
