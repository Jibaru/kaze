import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Plays the spoken summary, and stops the instant you want to talk.
 *
 * The summary arrives as one chunk at the end of the turn, so this is a single
 * `Audio` element rather than a streaming pipeline: after waiting 90 seconds for
 * a review, a second of synthesis is noise, and one file means replay is free.
 */
export function useSpokenSummary() {
  const audio = useRef<HTMLAudioElement | null>(null)
  const url = useRef<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [available, setAvailable] = useState(false)

  const release = useCallback(() => {
    audio.current?.pause()
    audio.current = null
    if (url.current) URL.revokeObjectURL(url.current)
    url.current = null
    setPlaying(false)
  }, [])

  const play = useCallback(() => {
    if (!audio.current) return
    audio.current.currentTime = 0
    void audio.current.play()
    setPlaying(true)
  }, [])

  /** Barge-in. Called on any mic key press, and safe when nothing is playing. */
  const stop = useCallback(() => {
    if (!audio.current) return
    audio.current.pause()
    setPlaying(false)
  }, [])

  const load = useCallback(
    (base64: string | null, autoplay = true) => {
      release()
      if (!base64) {
        setAvailable(false)
        return
      }
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
      url.current = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }))
      const element = new Audio(url.current)
      element.onended = () => setPlaying(false)
      audio.current = element
      setAvailable(true)
      if (autoplay) {
        void element.play()
        setPlaying(true)
      }
    },
    [release],
  )

  useEffect(() => release, [release])

  return { load, play, stop, playing, available }
}
