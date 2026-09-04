/**
 * The OpenAI audio calls, with no Electron in sight.
 *
 * Split out from `VoiceService` so the network shape can be exercised without a
 * running app: `VoiceService` owns the key and the filesystem, this owns the
 * protocol. Claude Code remains the brain — this is only ears and a mouth.
 */

import { coverage, similarity } from './text'

export const TRANSCRIBE_MODEL = 'gpt-4o-transcribe'
export const SPEECH_MODEL = 'gpt-4o-mini-tts'
/**
 * The one conversation mode uses. `tts-1` is the older, plainer voice and it
 * starts returning audio sooner, which is the only thing that matters when
 * somebody is waiting mid-sentence. The review summary keeps the better model:
 * you have already waited half a minute for the review, and nobody is holding a
 * conversation with it.
 */
export const FAST_SPEECH_MODEL = 'tts-1'

/** Raw PCM from the API: 24 kHz, signed 16-bit little-endian, mono. */
export const PCM_SAMPLE_RATE = 24_000
export const VOICE = 'alloy'

/**
 * Domain vocabulary for the transcriber. Without it "ElastiCache" comes back as
 * "elastic cash" and "multi-AZ" as "multi easy", and the review then argues with
 * words you did not say.
 */
const AWS_TERMS =
  'VPC, availability zone, multi-AZ, ALB, ECS, Fargate, RDS, Aurora, DynamoDB, ElastiCache, Redis, S3, SQS, SNS, Lambda, CloudFront, Route 53, API Gateway, p99, read replica, sharding, throughput'

export const AUDIO_PROMPT = `AWS system design review. Terms: ${AWS_TERMS}.`

/**
 * The Spanish prompt keeps the AWS terms in English, because that is how they
 * are said out loud in Spanish too: someone saying "la base de datos es
 * single-AZ" wants "single-AZ" back, not "una sola zona".
 */
const AUDIO_PROMPT_ES = `Revisión de diseño de sistemas en AWS, en español. Términos que se dicen en inglés: ${AWS_TERMS}.`

const promptFor = (language?: string): string =>
  language?.startsWith('es') ? AUDIO_PROMPT_ES : AUDIO_PROMPT

/**
 * How much of a transcript may be accounted for by the vocabulary prompt before
 * we treat it as an echo rather than speech. Real speech about a design reuses
 * some of these words; a transcript made *entirely* of them is the model
 * regurgitating the prompt because it heard nothing usable.
 */
const ECHO_COVERAGE = 0.85
const ECHO_SIMILARITY = 0.5

const SPEECH_INSTRUCTIONS =
  'Speak as a senior engineer giving interview feedback: measured, direct, unhurried. Not upbeat, not apologetic.'

export async function transcribeAudio(
  apiKey: string,
  audio: ArrayBuffer | Uint8Array,
  mimeType: string,
  language?: string,
): Promise<string> {
  const extension = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('wav') ? 'wav' : mimeType.includes('mp3') || mimeType.includes('mpeg') ? 'mp3' : 'webm'

  const form = new FormData()
  form.append('file', new Blob([audio as BlobPart], { type: mimeType }), `speech.${extension}`)
  form.append('model', TRANSCRIBE_MODEL)
  form.append('prompt', promptFor(language))
  // Naming the language stops the model guessing from the first syllable, which
  // is where short commands get mistaken for the other language entirely.
  if (language) form.append('language', language)

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  })
  if (!response.ok) throw new Error(`transcription failed (${response.status}): ${await response.text()}`)

  const body = (await response.json()) as { text?: string }
  const text = (body.text ?? '').trim()

  // Observed live: fed unintelligible audio, the model returns the vocabulary
  // prompt verbatim. Without this guard, silence fires a review off words the
  // user never said — a failure that looks exactly like success.
  if (isPromptEcho(text, language)) return ''
  return text
}

async function speechResponse(
  apiKey: string,
  text: string,
  model: string,
  format: 'mp3' | 'pcm',
): Promise<Response> {
  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      voice: VOICE,
      input: text,
      response_format: format,
      // Only the newer model takes them, and it silently ignores the field
      // rather than failing, which is why this is not conditional.
      instructions: SPEECH_INSTRUCTIONS,
    }),
  })
  if (!response.ok) throw new Error(`speech failed (${response.status}): ${await response.text()}`)
  return response
}

export async function synthesizeSpeech(apiKey: string, text: string): Promise<Uint8Array> {
  return new Uint8Array(await (await speechResponse(apiKey, text, SPEECH_MODEL, 'mp3')).arrayBuffer())
}

/**
 * Speech as it is generated, rather than once it is finished.
 *
 * Measured on a thirty-word reply: waiting for the whole file costs about four
 * seconds, of which roughly three are spent holding audio that already exists.
 * In a review that is nothing. In a conversation it is the difference between
 * an answer and a pause.
 *
 * PCM rather than mp3 because the renderer can schedule raw samples straight
 * into an AudioContext; playing a partial mp3 needs Media Source Extensions and
 * a container that tolerates being cut anywhere, and neither is worth it for
 * audio nobody keeps.
 */
export async function streamSpeech(
  apiKey: string,
  text: string,
  onChunk: (chunk: Uint8Array) => void,
): Promise<void> {
  const response = await speechResponse(apiKey, text, FAST_SPEECH_MODEL, 'pcm')
  const body = response.body
  if (!body) throw new Error('speech stream had no body')
  const reader = body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value?.length) onChunk(value)
  }
}

/** True when a transcript is just the vocabulary prompt handed back. */
export function isPromptEcho(text: string, language?: string): boolean {
  if (!text) return true
  const prompt = promptFor(language)
  return coverage(text, prompt) >= ECHO_COVERAGE || similarity(text, prompt) >= ECHO_SIMILARITY
}
