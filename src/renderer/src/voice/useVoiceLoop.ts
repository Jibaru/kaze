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
 *
 * The first numbers here were guesses and they were too high: nothing opened
 * the microphone at all. `usePushToTalk` treats anything above 0.012 RMS as
 * speech, which is the one measurement in this app taken from a real voice in
 * this room, so the bar to *start* listening has to sit under it, not at nearly
 * twice it.
 */
const FLOOR_FLOOR = 0.004
const OVER_FLOOR = 2.2
const MIN_THRESHOLD = 0.009

/**
 * Below this, over this long, the input is not quiet — it is dead. A real
 * microphone in an empty room still delivers its own noise floor, comfortably
 * above this; a virtual device with nothing routed into it delivers zeros.
 */
const DEAD_INPUT_RMS = 0.0006
const SILENCE_WINDOW_MS = 2500

export function useVoiceLoop({
  active,
  force,
  deviceId,
  onUtterance,
  onError,
  messages,
}: {
  /** Listen now. False while the app is thinking or speaking, and while muted. */
  active: boolean
  /**
   * Record regardless of what the detector thinks — the space bar, held.
   *
   * A hands-free microphone that does not open leaves you talking to a machine
   * that is not listening, with nothing on screen to say so. This is the way
   * out of that: it is the same gesture the rest of the app uses, and it works
   * whatever the room sounds like.
   */
  force: boolean
  /**
   * Which microphone. Not optional in practice: the system default is not
   * necessarily a microphone at all. On this machine it was a virtual device
   * that returns silence, which looks from the inside exactly like a room
   * where nobody is speaking — the detector never opens, nothing is ever sent,
   * and there is no error anywhere to notice.
   */
  deviceId: string
  onUtterance: (text: string) => void
  onError: (message: string) => void
  messages: { denied: string; nothing: string; empty: string }
}) {
  /**
   * The callbacks live in a ref, not in the effect's dependencies. They close
   * over the current diagram and so change on every edit, and rebuilding the
   * listening loop each time the model draws a box would mean the microphone
   * was never open for two consecutive seconds.
   */
  const handlers = useRef({ onUtterance, onError, messages })
  handlers.current = { onUtterance, onError, messages }
  const forced = useRef(force)
  forced.current = force
  /** Last tick's value, so releasing the key can be noticed. */
  const wasForced = useRef(false)

  const [state, setState] = useState<LoopState>('off')
  const [heard, setHeard] = useState('')
  /**
   * False once the input has been flat for a few seconds. A microphone that is
   * open and delivering nothing is the failure this app could not see, so it
   * is now something the mode can say out loud.
   */
  const [signal, setSignal] = useState(true)
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
  /** The device the open stream was acquired with. */
  const openedWith = useRef(deviceId)
  /** Loudest sample seen since the silence check last ran. */
  const window_ = useRef({ since: 0, loudest: 0 })
  /** Transcribing. The microphone stays open, but it must not start a second
   *  utterance on top of the one being sent. */
  const sending = useRef(false)
  /** Stops a teardown mid-flight from delivering an utterance nobody wants. */
  const generation = useRef(0)

  const send = useCallback(async (blob: Blob, spokeFor: number, loudest: number, mine: number) => {
    if (blob.size === 0) {
      // Should not happen, and did: this is the shape a recording bug takes,
      // so it says so rather than dropping you back to "listening" as though
      // you had not spoken.
      sending.current = false
      setState('listening')
      handlers.current.onError(handlers.current.messages.empty)
      return
    }
    if (spokeFor < MIN_SPEECH_MS || loudest < MIN_THRESHOLD) {
      // A chair, a cough, a door. Not worth a message.
      sending.current = false
      setState('listening')
      return
    }
    sending.current = true
    setState('transcribing')
    try {
      const text = await window.kaze.transcribe(await blob.arrayBuffer(), blob.type)
      if (mine !== generation.current) return
      if (!text) {
        handlers.current.onError(handlers.current.messages.nothing)
        setState('listening')
        return
      }
      setHeard(text)
      handlers.current.onUtterance(text)
    } catch (err) {
      if (mine !== generation.current) return
      setState('listening')
      handlers.current.onError(err instanceof Error ? err.message : String(err))
    } finally {
      sending.current = false
    }
  }, [])

  const closeUtterance = useCallback(() => {
    const rec = recorder.current
    recorder.current = null
    if (!rec || rec.state !== 'recording') return
    const spokeFor = Date.now() - startedAt.current
    const loudest = peak.current
    const mine = generation.current
    // The array is taken by reference, and deliberately NOT reset here.
    //
    // A recorder started without a timeslice delivers its audio in a single
    // `dataavailable` that fires *during* `stop()` — so emptying the ref at
    // close time hands the blob no data at all, every time. (It did: the mode
    // went "Te escucho" and straight back to "Escuchando", because an empty
    // blob takes the one path out of `send` that says nothing.)
    //
    // Race-free anyway, because each recorder pushes into the array its own
    // handler closed over: a later utterance points the ref at a new array
    // without touching this one.
    const captured = chunks.current
    rec.onstop = () => {
      void send(new Blob(captured, { type: 'audio/webm' }), spokeFor, loudest, mine)
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
      window_.current = { since: 0, loudest: 0 }
      return
    }

    let cancelled = false
    const mine = ++generation.current
    if (stream.current && openedWith.current !== deviceId) {
      stream.current.getTracks().forEach((track) => track.stop())
      stream.current = null
      analyser.current = null
    }
    openedWith.current = deviceId

    void (async () => {
      try {
        // Kept open for the life of the mode: re-acquiring costs ~300 ms, which
        // in a conversation is a stutter at the start of every answer.
        stream.current ??= await navigator.mediaDevices.getUserMedia({
          audio: {
            // `exact`, so a device that has gone away fails loudly instead of
            // quietly falling back to the default that caused the problem.
            ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
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

        // Half scale is the threshold, so the meter shows not just that the
        // microphone hears something but whether it hears enough.
        // Is anything at all arriving? Distinct from "is anyone speaking":
        // a flat line means the wrong device, not a quiet room.
        const now = Date.now()
        const w = window_.current
        if (w.since === 0) w.since = now
        w.loudest = Math.max(w.loudest, rms)
        if (now - w.since > SILENCE_WINDOW_MS) {
          setSignal(w.loudest > DEAD_INPUT_RMS)
          window_.current = { since: now, loudest: 0 }
        }

        const next = Math.min(1, rms / (threshold * 2))
        // Twenty-five renders a second of the whole app is a real cost, and the
        // eye cannot see a two-percent step anyway.
        setLevel((current) => (Math.abs(current - next) > 0.02 ? next : current))

        if (!recording) {
          // The floor only learns while nobody is talking, or a long sentence
          // would raise it until it swallowed the end of itself.
          floor.current = Math.max(FLOOR_FLOOR, floor.current * 0.94 + rms * 0.06)
          open.current = speaking ? open.current + 1 : 0
          if (!sending.current && (forced.current || open.current >= OPEN_FRAMES)) {
            startedAt.current = Date.now()
            quietSince.current = 0
            peak.current = rms
            // Its own array, closed over by its own handler — see
            // `closeUtterance` for why this must not be the shared ref.
            const buffer: Blob[] = []
            chunks.current = buffer
            const rec = new MediaRecorder(stream.current!, { mimeType: 'audio/webm' })
            rec.ondataavailable = (e) => {
              if (e.data.size > 0) buffer.push(e.data)
            }
            recorder.current = rec
            rec.start()
            setState('hearing')
          }
        } else {
          peak.current = Math.max(peak.current, rms)
          if (speaking || forced.current) quietSince.current = 0
          else if (quietSince.current === 0) quietSince.current = Date.now()

          const quietFor = quietSince.current ? Date.now() - quietSince.current : 0
          // Letting go of the key ends the utterance at once: you decided it
          // was over, and the detector has no better opinion than yours.
          const released = wasForced.current && !forced.current
          if (released || quietFor > CLOSE_MS || Date.now() - startedAt.current > MAX_SPEECH_MS) {
            closeUtterance()
          }
        }

        wasForced.current = forced.current
        timer.current = window.setTimeout(tick, SAMPLE_MS)
      }
      tick()
    })()

    return () => {
      cancelled = true
      if (timer.current) window.clearTimeout(timer.current)
      timer.current = null
    }
  }, [active, deviceId, closeUtterance])

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

  return { state, heard, level, signal, release }
}
