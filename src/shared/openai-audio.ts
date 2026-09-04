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
export const VOICE = 'alloy'

/**
 * Domain vocabulary for the transcriber. Without it "ElastiCache" comes back as
 * "elastic cash" and "multi-AZ" as "multi easy", and the review then argues with
 * words you did not say.
 */
export const AUDIO_PROMPT =
  'AWS system design review. Terms: VPC, availability zone, multi-AZ, ALB, ECS, Fargate, RDS, Aurora, DynamoDB, ElastiCache, Redis, S3, SQS, SNS, Lambda, CloudFront, Route 53, API Gateway, p99 latency, read replica, sharding, throughput.'

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
): Promise<string> {
  const extension = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('wav') ? 'wav' : mimeType.includes('mp3') || mimeType.includes('mpeg') ? 'mp3' : 'webm'

  const form = new FormData()
  form.append('file', new Blob([audio as BlobPart], { type: mimeType }), `speech.${extension}`)
  form.append('model', TRANSCRIBE_MODEL)
  form.append('prompt', AUDIO_PROMPT)

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
  if (isPromptEcho(text)) return ''
  return text
}

export async function synthesizeSpeech(apiKey: string, text: string): Promise<Uint8Array> {
  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: SPEECH_MODEL,
      voice: VOICE,
      input: text,
      response_format: 'mp3',
      instructions: SPEECH_INSTRUCTIONS,
    }),
  })
  if (!response.ok) throw new Error(`speech failed (${response.status}): ${await response.text()}`)
  return new Uint8Array(await response.arrayBuffer())
}

/** True when a transcript is just the vocabulary prompt handed back. */
export function isPromptEcho(text: string): boolean {
  if (!text) return true
  return coverage(text, AUDIO_PROMPT) >= ECHO_COVERAGE || similarity(text, AUDIO_PROMPT) >= ECHO_SIMILARITY
}
