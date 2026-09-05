import type { KeyboardEvent } from 'react'
import type { AudioInput } from '../voice/useAudioInputs'
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

export type ChatState = 'opening' | 'listening' | 'hearing' | 'transcribing' | 'thinking' | 'speaking' | 'muted'

export function ConversationBar({
  state,
  muted,
  level,
  say,
  heard,
  note,
  lesson,
  listening,
  signal,
  inputs,
  deviceId,
  onDevice,
  rateLabel,
  onCycleRate,
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
  /** Whatever went wrong with the microphone. Shown here because the status
   *  bar this used to use is not on screen in this mode. */
  note: string
  /** Set when the mode is a lesson rather than a design conversation. */
  lesson: { title: string; step: number; steps: number } | null
  /** The detector is actually running, as opposed to the chip merely saying so. */
  listening: boolean
  /** The chosen microphone is delivering something. False means a dead input. */
  signal: boolean
  inputs: AudioInput[]
  deviceId: string
  onDevice: (id: string) => void
  /** How fast it reads, e.g. "1.5×". Asked of the synthesizer, not of the
   *  audio afterwards — see `useSpeechRate`. */
  rateLabel: string
  onCycleRate: () => void
  onToggleMute: () => void
  /** Stop it talking and start listening again. */
  onInterrupt: () => void
  onExit: () => void
}) {
  const t = useT()
  const busy = state === 'thinking' || state === 'transcribing' || state === 'opening'

  /**
   * Space is the talk key in this mode, and a focused button activates on
   * space. Without this, pressing space to speak also presses whichever
   * control you last clicked — observed live as the microphone silently
   * un-muting itself mid-sentence. Enter still works, and focus is left where
   * it is rather than blurred out from under a keyboard user.
   */
  const holdKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.code === 'Space') e.preventDefault()
  }

  return (
    <div className="chatbar">
      {/* Which lesson, and how far in. The count is the app's — the concept
          file says how many ideas there are — so it means the same thing every
          time rather than tracking the model's sense of progress. */}
      {lesson && (
        <p className="chatbar__lesson">
          <span className="chatbar__lessonTitle">{lesson.title}</span>
          <span className="chatbar__lessonStep">{t.studyStep(lesson.step, lesson.steps)}</span>
        </p>
      )}

      <div className="chatbar__captions">
        {/* The failure this app could not see. A microphone that is open and
            delivering silence looks exactly like a quiet room from in here,
            and on this machine the system default was a virtual device that
            returns nothing at all. */}
        {listening && !signal && (
          <p className="chatbar__note" role="status">
            {t.chatNoSignal}
          </p>
        )}
        {note && (
          <p className="chatbar__note" role="status">
            {note}
          </p>
        )}
        {heard && (
          <p className="chatbar__heard">
            <span className="chatbar__who">{t.chatYou}</span> {heard}
          </p>
        )}
        {say && (
          <p className={`chatbar__say${busy ? ' chatbar__say--stale' : ''}`}>
            {say}
            {/* Under the last thing it said, because that is where you are
                already looking while you wait for the next one. */}
            {busy && <span className="chatbar__working" aria-hidden />}
          </p>
        )}
      </div>

      {/* The state, as the largest thing in the chrome.
          It used to be small grey text in the button row, which is a fine
          place for something you look up and a useless one for the only
          question you have while you wait: is it doing anything? */}
      <button
        className={`chatstate chatstate--${state}`}
        onClick={state === 'speaking' ? onInterrupt : onToggleMute}
        onKeyDown={holdKey}
        aria-live="polite"
        title={state === 'speaking' ? t.chatInterrupt : t.chatMuteHint}
      >
        <span className="chatstate__mark" aria-hidden>
          {busy ? <span className="chatstate__spinner" /> : <span className="chatstate__dot" />}
        </span>
        {t.chatState[state]}
      </button>

      <div className="chatbar__controls">
        {inputs.length > 1 && (
          <select
            className="chatbar__device"
            aria-label={t.chatDevice}
            title={t.chatDevice}
            value={deviceId}
            onChange={(e) => onDevice(e.target.value)}
          >
            {inputs.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
              </option>
            ))}
          </select>
        )}

        {/* Always on screen, not only while it is recording.
            "I spoke and nothing happened" and "I spoke and it did not hear me"
            look identical without this, and only one of them is fixable by
            speaking up. Half scale is the level at which it starts listening. */}
        <span className="meter" title={t.chatMeterHint} aria-hidden>
          {[0.14, 0.34, 0.54, 0.74, 0.94].map((at) => (
            <span
              key={at}
              className={`meter__bar${level >= at ? ' meter__bar--lit' : ''}${at >= 0.5 ? ' meter__bar--over' : ''}`}
            />
          ))}
        </span>

        {/* Cycles, like the canvas toolbar: one control, five speeds, and the
            current one is the label. It applies to the next thing it says —
            the sentence you are hearing was already synthesized. */}
        <button
          className="btn btn--ghost speedbtn"
          onClick={onCycleRate}
          onKeyDown={holdKey}
          title={t.speechRateHint}
          aria-label={t.speechRateNow(rateLabel)}
        >
          {rateLabel}
        </button>

        <button
          className={`btn btn--ghost chatbar__mute${muted ? ' chatbar__mute--on' : ''}`}
          onClick={onToggleMute}
          onKeyDown={holdKey}
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

        <button className="btn btn--ghost" onClick={onExit} onKeyDown={holdKey}>
          {t.chatExit}
        </button>
      </div>

      <p className="chatbar__hint">{t.chatHoldHint}</p>
    </div>
  )
}
