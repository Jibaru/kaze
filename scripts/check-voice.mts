/**
 * The voice path, live: synthesize a spoken summary, then transcribe it back and
 * check the words survive the round trip. If AWS vocabulary does not come back
 * intact, the review ends up arguing with words you never said.
 *
 * The key is read from OPENAI_API_KEY and never written anywhere.
 * Run: OPENAI_API_KEY=... node scripts/check.mjs scripts/check-voice.mts
 */
import assert from 'node:assert/strict'
import { AUDIO_PROMPT, isPromptEcho, synthesizeSpeech, transcribeAudio } from '../src/shared/openai-audio.ts'

const checks: Array<[string, boolean, string?]> = []
const check = (name: string, pass: boolean, detail = '') => checks.push([name, pass, detail])

const key = process.env.OPENAI_API_KEY
if (!key) {
  console.error('set OPENAI_API_KEY')
  process.exit(2)
}

/** A real spoken summary: the exact vocabulary the transcriber has to survive. */
const summary =
  'This design does not yet meet the brief. The mapping store is a single-AZ RDS instance with no backup, ' +
  'so losing that availability zone loses the data. Put ElastiCache in front of it and enable multi-AZ with ' +
  'point-in-time recovery. The p99 latency target also needs CloudFront at the edge rather than a single ALB.'

/** 16-bit mono PCM silence, so the guard can be exercised against real audio. */
function silentWav(seconds: number, rate = 16000): Uint8Array {
  const samples = seconds * rate
  const buffer = new ArrayBuffer(44 + samples * 2)
  const view = new DataView(buffer)
  const ascii = (offset: string, at: number) => [...offset].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)))
  ascii('RIFF', 0)
  view.setUint32(4, 36 + samples * 2, true)
  ascii('WAVEfmt ', 8)
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  ascii('data', 36)
  view.setUint32(40, samples * 2, true)
  return new Uint8Array(buffer)
}

const started = Date.now()
const mp3 = await synthesizeSpeech(key, summary)
const synthMs = Date.now() - started

check('speech synthesis returns audio', mp3.byteLength > 5000, `${Math.round(mp3.byteLength / 1024)} KB`)
check('it is an mp3', mp3[0] === 0xff || (mp3[0] === 0x49 && mp3[1] === 0x44), `first bytes ${mp3[0]?.toString(16)} ${mp3[1]?.toString(16)}`)
check('synthesis is fast enough to feel instant after a 90s review', synthMs < 15000, `${synthMs}ms`)

const heardStart = Date.now()
const heard = await transcribeAudio(key, mp3, 'audio/mpeg')
const transcribeMs = Date.now() - heardStart

console.log(`\nspoken back: ${heard}\n`)

const lower = heard.toLowerCase()
check('transcription returns text', heard.length > 100, `${heard.split(/\s+/).length} words`)
check('transcription is quick enough for push-to-talk', transcribeMs < 20000, `${transcribeMs}ms`)

// The vocabulary check is the point: these are the words a generic transcriber
// mangles, and the prompt in openai-audio.ts exists to stop it.
for (const term of ['multi-az', 'rds', 'elasticache', 'cloudfront', 'alb', 'p99']) {
  check(`"${term}" survives the round trip`, lower.includes(term), lower.includes(term) ? '' : heard.slice(0, 200))
}

// ── the prompt-echo guard ─────────────────────────────────────────────────
// Observed live: fed unintelligible audio, the transcriber returns the
// vocabulary prompt verbatim, and the app then fires a review off words the
// user never said. That failure looks exactly like success, so it is guarded
// and the guard is tested.
check('the vocabulary prompt itself is recognised as an echo', isPromptEcho(AUDIO_PROMPT))
check('a trimmed run of prompt terms is recognised as an echo',
  isPromptEcho('VPC, availability zone, multi-AZ, ALB, ECS, Fargate, RDS, Aurora, DynamoDB, ElastiCache.'))
check('empty audio counts as an echo', isPromptEcho(''))
check('a real spoken command is NOT an echo',
  !isPromptEcho('Review this design and tell me what is wrong with the database.'))
// The hard case: genuine speech that happens to use the same vocabulary.
check('genuine speech about multi-AZ RDS is NOT an echo',
  !isPromptEcho('Can you check whether the RDS instance should be multi-AZ, and whether ElastiCache belongs in front of it?'))
check('the synthesized summary is NOT an echo', !isPromptEcho(heard))

// Live: silence does NOT reliably transcribe to nothing. It came back as
// "context:" — a hallucination the echo guard cannot catch, because it is not
// the prompt. That is why the renderer gates on peak RMS and never sends silent
// audio at all; this check documents the upstream behaviour rather than
// pretending the transcriber is trustworthy on empty input.
const fromSilence = await transcribeAudio(key, silentWav(2), 'audio/wav')
console.log(`silence transcribed as: ${JSON.stringify(fromSilence)}`)
check('silence never yields a plausible command (guard is the renderer RMS gate)',
  fromSilence.split(/\s+/).filter(Boolean).length <= 2, JSON.stringify(fromSilence).slice(0, 120))

for (const [name, pass, detail] of checks) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}
const failed = checks.filter(([, pass]) => !pass)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
assert.equal(failed.length, 0)
