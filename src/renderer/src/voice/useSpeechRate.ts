import { useCallback, useState } from 'react'
import { SPEECH_RATES } from '@shared/openai-audio'

/**
 * How fast it talks, and remembering the answer.
 *
 * Two different mechanisms sit behind one number, because the two places this
 * app speaks are not the same kind of audio:
 *
 *   - **Conversation mode** asks the synthesizer to read faster. Web Audio has
 *     no time-stretching, so speeding a buffer up shifts its pitch, and a
 *     reviewer who sounds like a chipmunk at 1.5x is not a faster reviewer.
 *     Reading faster also means less audio to generate, so the setting cuts the
 *     pause before the first word as well as the length of it.
 *   - **The review summary** is a finished mp3 played by an `<audio>` element,
 *     which time-stretches and keeps the pitch for free. Re-synthesizing it to
 *     change speed would throw away a file you can replay.
 *
 * Kept in `localStorage` rather than through the main process, where the locale
 * and fast mode live. Those are there because main *uses* them — to write
 * prompts, to pick a profile. Nothing in main needs to know how fast you like
 * being talked to; it is told the number when it matters.
 */

const KEY = 'kaze.speechRate'

const read = (): number => {
  try {
    const stored = Number(localStorage.getItem(KEY))
    return SPEECH_RATES.includes(stored as (typeof SPEECH_RATES)[number]) ? stored : 1
  } catch {
    return 1
  }
}

export function useSpeechRate() {
  const [rate, setRate] = useState(read)

  /** One control, cycling — the same gesture as the canvas toolbar. */
  const cycle = useCallback(() => {
    setRate((current) => {
      const next = SPEECH_RATES[(SPEECH_RATES.indexOf(current as (typeof SPEECH_RATES)[number]) + 1) % SPEECH_RATES.length]!
      try {
        localStorage.setItem(KEY, String(next))
      } catch {
        // Not worth failing over; it just will not be remembered.
      }
      return next
    })
  }, [])

  return { rate, cycle, label: `${rate}×` }
}
