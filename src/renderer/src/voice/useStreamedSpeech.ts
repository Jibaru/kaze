import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatAudio } from '@shared/types'

/**
 * Plays speech while it is still being generated.
 *
 * Measured on a thirty-word reply, waiting for the finished file cost about
 * four seconds, roughly three of which were spent holding audio that already
 * existed. `useSpokenSummary` is right for a review — one file, replayable,
 * arriving after you have already waited half a minute — and wrong for a
 * conversation, where three seconds of dead air is the whole feeling of the
 * thing being slow.
 *
 * Raw PCM rather than mp3: samples can be handed straight to an AudioContext,
 * whereas playing a partial mp3 needs Media Source Extensions and a container
 * that tolerates being cut at an arbitrary byte. Nobody keeps this audio, so
 * there is nothing to gain from a format that survives being saved.
 *
 * Chunks are scheduled back to back on the context's own clock rather than
 * played on `ended`, because a gap between two buffers is audible as a click
 * and the clock is the only thing accurate enough to avoid one.
 */

/** Matches `PCM_SAMPLE_RATE` in the audio protocol. */
const SAMPLE_RATE = 24_000
/** A beat of lead so the first buffer is not scheduled in the past. */
const LEAD_S = 0.08

export function useStreamedSpeech() {
  const [playing, setPlaying] = useState(false)

  const context = useRef<AudioContext | null>(null)
  const sources = useRef<AudioBufferSourceNode[]>([])
  /** Where the next buffer starts on the context clock. */
  const nextStart = useRef(0)
  /** The utterance being played; anything else that arrives is stale. */
  const seq = useRef(-1)
  /** A chunk can split a 16-bit sample; the odd byte waits here. */
  const carry = useRef<Uint8Array | null>(null)
  /** No more chunks are coming, so the last one to end ends the utterance. */
  const ended = useRef(false)

  const stop = useCallback(() => {
    for (const s of sources.current) {
      s.onended = null
      try {
        s.stop()
      } catch {
        // Already finished. Stopping a stopped source throws; that is fine.
      }
    }
    sources.current = []
    carry.current = null
    ended.current = false
    // Anything still in flight for this utterance is dropped rather than
    // played after you have interrupted it.
    seq.current = -1
    setPlaying(false)
  }, [])

  const push = useCallback((audio: ChatAudio) => {
    if (audio.seq < seq.current) return

    if (audio.seq > seq.current) {
      // A new utterance supersedes whatever was still playing.
      stop()
      seq.current = audio.seq
      context.current ??= new AudioContext({ sampleRate: SAMPLE_RATE })
      if (context.current.state === 'suspended') void context.current.resume()
      nextStart.current = context.current.currentTime + LEAD_S
    }

    if (audio.chunk === null) {
      ended.current = true
      // Silence that never produced a single buffer still has to clear the
      // playing flag, or the microphone never reopens.
      if (sources.current.length === 0) setPlaying(false)
      return
    }

    const ctx = context.current
    if (!ctx) return

    const raw = Uint8Array.from(atob(audio.chunk), (c) => c.charCodeAt(0))
    let bytes = raw
    if (carry.current) {
      bytes = new Uint8Array(carry.current.length + raw.length)
      bytes.set(carry.current)
      bytes.set(raw, carry.current.length)
      carry.current = null
    }
    if (bytes.length % 2 === 1) {
      carry.current = bytes.subarray(bytes.length - 1)
      bytes = bytes.subarray(0, bytes.length - 1)
    }
    if (bytes.length === 0) return

    const samples = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2)
    const buffer = ctx.createBuffer(1, samples.length, SAMPLE_RATE)
    const channel = buffer.getChannelData(0)
    for (let i = 0; i < samples.length; i++) channel[i] = samples[i]! / 32_768

    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(ctx.destination)
    // Never behind the clock: a late chunk would otherwise be scheduled in the
    // past and dropped, taking a word of the sentence with it.
    nextStart.current = Math.max(nextStart.current, ctx.currentTime + 0.02)
    source.start(nextStart.current)
    nextStart.current += buffer.duration

    sources.current.push(source)
    setPlaying(true)
    source.onended = () => {
      sources.current = sources.current.filter((s) => s !== source)
      if (ended.current && sources.current.length === 0) setPlaying(false)
    }
  }, [stop])

  useEffect(() => window.kaze.onChatAudio(push), [push])

  useEffect(
    () => () => {
      void context.current?.close()
      context.current = null
    },
    [],
  )

  return { playing, stop }
}
