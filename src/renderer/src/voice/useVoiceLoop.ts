import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * A hot microphone that decides for itself when you have stopped talking.
 *
 * Push-to-talk is right for the rest of the app and wrong here — see
 * `usePushToTalk`, which says so. Holding a key through every turn of a
 * conversation is not a conversation, and the mode has a mute button precisely
 * because the microphone is otherwise open.
 *
 * The detector is deliberately dull: RMS over a 40 ms window, a threshold that
 * floats above the room's own noise, three frames to open and 800 ms of quiet
 * to close. Nothing here is learned, nothing is uploaded to decide whether you
 * spoke, and a false open costs one discarded recording rather than a turn.
 *
 * It does **not** listen while the app is talking. Echo cancellation would
 * probably hold, but "probably" is a bad property for a loop that could end up
 * transcribing its own voice and answering itself; the caller sets `active` to
 * false while playing, and barge-in is a key or a click instead.
 */

export type LoopState = 'off' | 'listening' | 'hearing' | 'transcribing'

const SAMPLE_MS = 40
/** Frames above the threshold before this counts as speech and not a door. */
const OPEN_FRAMES = 3
/** Quiet before the utterance is considered finished. A beat, not a pause. */
const CLOSE_MS = 800
/** Shorter than this is a cough. */
const MIN_SPEECH_MS = 400
/** Longer than this and something is wrong; send what there is. */
const MAX_SPEECH_MS = 30_000

/**
 * The floor the threshold floats above, and the floor under the floor.
 *
 * A room with a fan in it should not hold the microphone open forever, and a
 * silent room should not make the threshold so low that the analyser's own
 * noise opens it.
 */
const FLOOR_FLOOR = 0.006
const OVER_FLOOR = 3.5
const MIN_THRESHOLD = 0.014

export function useVoiceLoop({
  active,
  onUtterance,
  onError,
  messages,
}: {
  /** Listen now. False while the app is thinking or speaking, and while muted. */
  active: boolean
  onUtterance: (text: string) => void
  onError: (message: string) => void
  messages: { denied: string; nothing: string }
}) {
  /**
   * The callbacks live in a ref, not in the effect's dependencies. They close
   * over the current diagram and so change on every edit, and rebuilding the
   * listening loop each time the model draws a box would mean the microphone
   * was never open for two consecutive seconds.
   */
  const handlers = useRef({ onUtterance, onError, messages })
  handlers.current = { onUtterance, onError, messages }

  const [state, setState] = useState<LoopState>('off')
  const [heard, setHeard] = useState('')
  /** 0..1, for the level ring. Rendered, so it lives in state. */
  const [level, setLevel] = useState(0)

  const stream = useRef<MediaStream | null>(null)
  const context = useRef<AudioContext | null>(null)
  const analyser = useRef<AnalyserNode | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const timer = useRef<number | null>(null)

  const floor = useRef(0.01)
  const open = useRef(0)
  const startedAt = useRef(0)
  const quietSince = useRef(0)
  const peak = useRef(0)
  /** Stops a teardown mid-flight from delivering an utterance nobody wants. */
  const generation = useRef(0)

  const send = useCallback(async (blob: Blob, spokeFor: number, loudest: number, mine: number) => {
    if (spokeFor < MIN_SPEECH_MS || blob.size === 0 || loudest < MIN_THRESHOLD) return
    setState('transcribing')
    try {
      const text = await window.kaze.transcribe(await blob.arrayBuffer(), blob.type)
      if (mine !== generation.current) return
      if (!text) {
        setState('listening')
        handlers.current.onError(handlers.current.messages.nothing)
        return
      }
      setHeard(text)
      handlers.current.onUtterance(text)
    } catch (err) {
      if (mine !== generation.current) return
      setState('listening')
      handlers.current.onError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const closeUtterance = useCallback(() => {
    const rec = recorder.current
    recorder.current = null
    if (!rec || rec.state !== 'recording') return
    const spokeFor = Date.now() - startedAt.current
    const loudest = peak.current
    const mine = generation.current
    rec.onstop = () => {
      void send(new Blob(chunks.current, { type: 'audio/webm' }), spokeFor, loudest, mine)
    }
    rec.stop()
  }, [send])

  useEffect(() => {
    if (!active) {
      // Anything half-recorded when the app starts talking is dropped rather
      // than sent: it is the tail of a sentence whose answer is already coming.
      generation.current += 1
      if (recorder.current?.state === 'recording') {
        recorder.current.onstop = null
        recorder.current.stop()
      }
      recorder.current = null
      if (timer.current) window.clearTimeout(timer.current)
      timer.current = null
      setState('off')
      setLevel(0)
      return
    }

    let cancelled = false
    const mine = ++generation.current

    void (async () => {
      try {
        // Kept open for the life of the mode: re-acquiring costs ~300 ms, which
        // in a conversation is a stutter at the start of every answer.
        stream.current ??= await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        })
      } catch {
        handlers.current.onError(handlers.current.messages.denied)
        return
      }
      if (cancelled || mine !== generation.current) return

      context.current ??= new AudioContext()
      if (!analyser.current) {
        analyser.current = context.current.createAnalyser()
        analyser.current.fftSize = 1024
        context.current.createMediaStreamSource(stream.current).connect(analyser.current)
      }
      // Suspended by Chromium when the window loses focus; without this the
      // level goes flat and the microphone silently stops hearing anything.
      if (context.current.state === 'suspended') void context.current.resume()

      const samples = new Float32Array(analyser.current.fftSize)
      setState('listening')

      const tick = () => {
        analyser.current?.getFloatTimeDomainData(samples)
        let sum = 0
        for (const v of samples) sum += v * v
        const rms = Math.sqrt(sum / samples.length)
        const threshold = Math.max(floor.current * OVER_FLOOR, MIN_THRESHOLD)
        const speaking = rms > threshold
        const recording = recorder.current?.state === 'recording'

        setLevel(Math.min(1, rms / (threshold * 3)))

        if (!recording) {
          // The floor only learns while nobody is talking, or a long sentence
          // would raise it until it swallowed the end of itself.
          floor.current = Math.max(FLOOR_FLOOR, floor.current * 0.94 + rms * 0.06)
          open.current = speaking ? open.current + 1 : 0
          if (open.current >= OPEN_FRAMES) {
            chunks.current = []
            startedAt.current = Date.now()
            quietSince.current = 0
            peak.current = rms
            const rec = new MediaRecorder(stream.current!, { mimeType: 'audio/webm' })
            rec.ondataavailable = (e) => {
              if (e.data.size > 0) chunks.current.push(e.data)
            }
            recorder.current = rec
            rec.start()
            setState('hearing')
          }
        } else {
          peak.current = Math.max(peak.current, rms)
          if (speaking) quietSince.current = 0
          else if (quietSince.current === 0) quietSince.current = Date.now()

          const quietFor = quietSince.current ? Date.now() - quietSince.current : 0
          if (quietFor > CLOSE_MS || Date.now() - startedAt.current > MAX_SPEECH_MS) {
            closeUtterance()
          }
        }

        timer.current = window.setTimeout(tick, SAMPLE_MS)
      }
      tick()
    })()

    return () => {
      cancelled = true
      if (timer.current) window.clearTimeout(timer.current)
      timer.current = null
    }
  }, [active, closeUtterance])

  /** Let go of the device when the mode closes; a lit mic light is a promise. */
  const release = useCallback(() => {
    generation.current += 1
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = null
    if (recorder.current?.state === 'recording') {
      recorder.current.onstop = null
      recorder.current.stop()
    }
    recorder.current = null
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
    void context.current?.close()
    context.current = null
    analyser.current = null
    setState('off')
    setLevel(0)
  }, [])

  useEffect(() => release, [release])

  return { state, heard, level, release }
}
