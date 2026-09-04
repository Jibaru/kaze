import { safeStorage } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { streamSpeech, synthesizeSpeech, transcribeAudio } from '../shared/openai-audio'

/**
 * Owns the OpenAI credential and the audio files. The protocol lives in
 * `shared/openai-audio.ts`; this is the part that must not leave the main
 * process.
 *
 * The key never enters the renderer — audio blobs are sent *to* main for
 * transcription rather than the renderer holding a credential it could leak. It
 * is encrypted with `safeStorage` (DPAPI on Windows), which ties it to the OS
 * account instead of leaving it readable in a dotfile.
 */
export interface SpokenAudio {
  path: string
  /** base64 mp3, so the renderer can play it without filesystem access. */
  data: string
}

export class VoiceService {
  private readonly keyPath: string
  private cached: string | null = null

  constructor(keyPath: string) {
    this.keyPath = keyPath
  }

  async hasKey(): Promise<boolean> {
    return (await this.key()) !== null
  }

  async setKey(key: string): Promise<void> {
    const trimmed = key.trim()
    if (!trimmed) throw new Error('empty key')
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('OS encryption is unavailable, refusing to store the key in plaintext')
    }
    await mkdir(dirname(this.keyPath), { recursive: true })
    await writeFile(this.keyPath, safeStorage.encryptString(trimmed))
    this.cached = trimmed
  }

  private async key(): Promise<string | null> {
    if (this.cached) return this.cached
    if (!existsSync(this.keyPath)) return null
    try {
      this.cached = safeStorage.decryptString(await readFile(this.keyPath))
      return this.cached
    } catch {
      return null
    }
  }

  private async require(): Promise<string> {
    const key = await this.key()
    if (!key) throw new Error('No OpenAI key set. Add one in the voice bar.')
    return key
  }

  /** Speech to text. Returns '' for silence rather than throwing. */
  async transcribe(audio: ArrayBuffer, mimeType: string, language?: string): Promise<string> {
    return transcribeAudio(await this.require(), audio, mimeType, language)
  }

  /** Text to speech, written next to the attempt so it can be replayed later. */
  async speak(text: string, outputPath: string): Promise<SpokenAudio> {
    const bytes = await synthesizeSpeech(await this.require(), text)
    await mkdir(dirname(outputPath), { recursive: true })
    await writeFile(outputPath, bytes)
    return { path: outputPath, data: Buffer.from(bytes).toString('base64') }
  }

  /**
   * Speech as it arrives. Nothing is written to disk: a line of a conversation
   * is not something you replay, and waiting for a file before playing it is
   * exactly the wait this exists to remove.
   */
  async speakStreaming(
    text: string,
    speed: number,
    onChunk: (chunk: Uint8Array) => void,
  ): Promise<void> {
    await streamSpeech(await this.require(), text, speed, onChunk)
  }

  static audioPath(attemptDir: string, revision: number): string {
    return join(attemptDir, 'audio', `${String(revision).padStart(3, '0')}-summary.mp3`)
  }
}
