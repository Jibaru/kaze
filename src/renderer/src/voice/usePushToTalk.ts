import { useCallback, useEffect, useRef, useState } from 'react'
import type { TurnIntent } from '@shared/types'

/**
 * Push to talk.
 *
 * Hold **Space** to ask for a review; hold **Shift+Space** to ask a question.
 * The intent is decided by which key you hold, not by classifying what you said:
 * a classifier will eventually mistake a throwaway question for a review request
 * and reset your findings panel, and a physical distinction never does.
 *
 * Deliberately not always-on VAD. A review is a punctuated act, and a hot mic
 * in a room where you are thinking out loud fires constantly.
 */

export type MicState = 'idle' | 'recording' | 'transcribing'

const MIN_SPEECH_MS = 350

/**
 * Peak RMS below which the recording is treated as silence and never sent.
 *
 * This is the real defence against a hallucinated transcript: asked to
 * transcribe silence, the model does not return nothing — it returns something
 * plausible ("context:", or the vocabulary prompt verbatim), and the app would
 * then fire a review off words nobody said. Cheaper and far more reliable to
 * notice there was no speech than to argue with the transcript afterwards.
 */
const SILENCE_PEAK_RMS = 0.012

/** Typing a question into the ask box must not start the microphone. */
function isTyping(): boolean {
  const el = document.activeElement
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable
}

export function usePushToTalk({
  enabled,
  onUtterance,
  onBargeIn,
  onError,
  messages,
}: {
  enabled: boolean
  onUtterance: (text: string, intent: TurnIntent) => void
  /** Fires the instant a key goes down, before any audio: stop the playback. */
  onBargeIn: () => void
  onError: (message: string) => void
  /** Passed in rather than imported, so the hook holds no opinion on language. */
  messages: { denied: string; nothing: string; nothingMic: string }
}) {
  const [state, setState] = useState<MicState>('idle')
  const [heard, setHeard] = useState('')
  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const intent = useRef<TurnIntent>('review')
  const startedAt = useRef(0)
  const stream = useRef<MediaStream | null>(null)
  const context = useRef<AudioContext | null>(null)
  const analyser = useRef<AnalyserNode | null>(null)
  const meter = useRef<number | null>(null)
  const peak = useRef(0)

  const stop = useCallback(() => {
    if (recorder.current?.state === 'recording') recorder.current.stop()
  }, [])

  const start = useCallback(
    async (which: TurnIntent) => {
      if (recorder.current?.state === 'recording') return
      try {
        // Kept open between utterances: re-acquiring costs ~300ms, which is
        // most of a short command.
        stream.current ??= await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        })
      } catch {
        onError(messages.denied)
        return
      }

      intent.current = which
      chunks.current = []
      startedAt.current = Date.now()
      peak.current = 0

      // Level metering runs off the live stream rather than the encoded blob:
      // decoding webm/opus just to measure loudness would be absurd.
      context.current ??= new AudioContext()
      if (!analyser.current) {
        analyser.current = context.current.createAnalyser()
        analyser.current.fftSize = 1024
        context.current.createMediaStreamSource(stream.current).connect(analyser.current)
      }
      const samples = new Float32Array(analyser.current.fftSize)
      const sample = () => {
        analyser.current?.getFloatTimeDomainData(samples)
        let sum = 0
        for (const v of samples) sum += v * v
        peak.current = Math.max(peak.current, Math.sqrt(sum / samples.length))
        meter.current = window.setTimeout(sample, 50)
      }
      sample()

      const rec = new MediaRecorder(stream.current, { mimeType: 'audio/webm' })
      recorder.current = rec
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data)
      }
      rec.onstop = () => {
        if (meter.current) window.clearTimeout(meter.current)
        meter.current = null
        void (async () => {
          const held = Date.now() - startedAt.current
          const blob = new Blob(chunks.current, { type: 'audio/webm' })
          // A tap of the key is a mis-hit, not an utterance.
          if (held < MIN_SPEECH_MS || blob.size === 0) {
            setState('idle')
            return
          }
          if (peak.current < SILENCE_PEAK_RMS) {
            setState('idle')
            onError(messages.nothingMic)
            return
          }
          setState('transcribing')
          try {
            const text = await window.kaze.transcribe(await blob.arrayBuffer(), blob.type)
            setState('idle')
            if (!text) {
              onError(messages.nothing)
              return
            }
            setHeard(text)
            onUtterance(text, intent.current)
          } catch (err) {
            setState('idle')
            onError(err instanceof Error ? err.message : String(err))
          }
        })()
      }
      rec.start()
      setState('recording')
    },
    [onUtterance, onError, messages],
  )

  useEffect(() => {
    if (!enabled) return

    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || isTyping() || e.ctrlKey || e.metaKey || e.altKey) return
      e.preventDefault()
      // Barge-in first: whatever is playing stops the moment you reach for the
      // key, not when the recording finishes.
      onBargeIn()
      void start(e.shiftKey ? 'ask' : 'review')
    }

    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      e.preventDefault()
      stop()
    }

    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [enabled, start, stop, onBargeIn])

  // Release the microphone when the app closes the feature, so the OS stops
  // showing a recording indicator for an idle app.
  useEffect(
    () => () => {
      if (meter.current) window.clearTimeout(meter.current)
      stream.current?.getTracks().forEach((t) => t.stop())
      stream.current = null
      void context.current?.close()
      context.current = null
      analyser.current = null
    },
    [],
  )

  return { state, heard, startManually: start, stopManually: stop }
}
