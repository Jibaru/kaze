import { useT } from '../i18n/useLocale'

/**
 * The whole of conversation mode's chrome: what it is doing, what was said, a
 * mute and a way out.
 *
 * Everything else is deliberately gone — palette, rails, status bar — because
 * the point of the mode is that the diagram is the only thing on screen. What
 * stays is what you cannot infer from the canvas: whether the microphone is
 * open, and what it just heard you say.
 *
 * The caption is not decoration. This app has shown the transcript next to the
 * voice since the first sketch, for the same reason: a system that mishears
 * "sin réplicas" as "con réplicas" and silently draws the opposite is worse
 * than one that cannot hear at all.
 */

export type ChatState = 'listening' | 'hearing' | 'transcribing' | 'thinking' | 'speaking' | 'muted'

export function ConversationBar({
  state,
  muted,
  level,
  say,
  heard,
  onToggleMute,
  onInterrupt,
  onExit,
}: {
  state: ChatState
  /**
   * Whether the microphone is off. Separate from `state`, because it is a
   * resting state and `state` shows the thing currently happening: muted while
   * it is mid-sentence is both true at once.
   */
  muted: boolean
  /** 0..1 microphone level, for the ring. */
  level: number
  /** The last thing it said. */
  say: string
  /** The last thing it heard you say. */
  heard: string
  onToggleMute: () => void
  /** Stop it talking and start listening again. */
  onInterrupt: () => void
  onExit: () => void
}) {
  const t = useT()
  const busy = state === 'thinking' || state === 'transcribing'

  return (
    <div className="chatbar">
      <div className="chatbar__captions">
        {heard && (
          <p className="chatbar__heard">
            <span className="chatbar__who">{t.chatYou}</span> {heard}
          </p>
        )}
        {say && <p className="chatbar__say">{say}</p>}
      </div>

      <div className="chatbar__controls">
        {/* Live, because it is the one thing on screen that changes without
            the canvas changing. A conversation with no sign of life reads as
            broken long before it actually is. */}
        <button
          className={`chatstate chatstate--${state}`}
          onClick={state === 'speaking' ? onInterrupt : onToggleMute}
          aria-live="polite"
          title={state === 'speaking' ? t.chatInterrupt : t.chatMuteHint}
        >
          <span
            className="chatstate__ring"
            style={{ transform: `scale(${1 + (state === 'hearing' ? level * 0.5 : 0)})` }}
            aria-hidden
          />
          <span className="chatstate__dot" aria-hidden />
          {t.chatState[state]}
          {busy && <span className="chatstate__ellipsis" aria-hidden />}
        </button>

        <button
          className={`btn btn--ghost chatbar__mute${muted ? ' chatbar__mute--on' : ''}`}
          onClick={onToggleMute}
          aria-pressed={muted}
          title={t.chatMuteHint}
        >
          <svg viewBox="0 0 24 24" aria-hidden focusable="false">
            <path d="M12 3.5a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0v-5a3 3 0 0 1 3-3Z" />
            <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
            {muted && <path d="M4 4 20 20" className="chatbar__slash" />}
          </svg>
          {muted ? t.chatUnmute : t.chatMute}
        </button>

        <button className="btn btn--ghost" onClick={onExit}>
          {t.chatExit}
        </button>
      </div>
    </div>
  )
}
