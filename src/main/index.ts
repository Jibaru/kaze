import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell } from 'electron'
import { cp, mkdir, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { WorkspaceStore } from './workspace-store'
import { FAST_DISALLOWED, SessionManager } from './session-manager'
import { LiveSession } from './live-session'
import { VoiceService } from './voice-service'
import { listScenarios, readScenarioSource } from './scenarios'
import { authorPrompt, parseAuthored, writeScenario } from './scenario-author'
import {
  CONVERSATION_SYSTEM,
  conversationOpening,
  conversationTurn,
  spokenHalf,
  spokenHalfComplete,
} from './conversation'
import {
  FAST_ASK_SYSTEM,
  FAST_REVIEW_SYSTEM,
  fastAskPrompt,
  fastReviewPrompt,
  type FastContext,
} from './fast-review'
import { lastFencedJson, parseReview, REPAIR_PROMPT } from '../shared/findings'
import { parsePatch, type PatchOp } from '../shared/patch'
import { dict, REPLY_LANGUAGE, SPEECH_LANGUAGE, toLocale, type Locale } from '../shared/i18n'
import { reconcile } from '../shared/ledger'
import type { Ledger } from '../shared/ledger'
import type { ChatTurn, Diagram, ReviewEvent, ReviewOutcome, RevisionResult, TurnIntent } from '../shared/types'

const ATTEMPT = 'default'

/**
 * The fast conversation the reviewer runs in. Conversation mode does not use
 * one: it holds a live process of its own, see `live-session.ts`.
 */
const REVIEW_CHAT = 'review'

const workspaceRoot = join(app.getPath('userData'), 'workspace')
const store = new WorkspaceStore(workspaceRoot)

/** The template shipped with the app: CLAUDE.md, the skill, the scenario bank. */
const templateRoot = app.isPackaged
  ? join(process.resourcesPath, 'workspace')
  : join(__dirname, '../../workspace')

let win: BrowserWindow | null = null
const emit = (event: ReviewEvent) => win?.webContents.send('review:event', event)

const session = new SessionManager({
  cwd: store.attemptDir(ATTEMPT),
  emit: (event) => {
    // The conversation id is worth keeping: without it a restart quietly opens
    // a new conversation while the reviewer still reads the accumulated ledger
    // off disk.
    if (event.kind === 'session') void store.writeMeta({ sessionId: event.sessionId }, ATTEMPT)
    emit(event)
  },
})
const voice = new VoiceService(join(app.getPath('userData'), 'openai.key'))

/**
 * Conversation mode keeps one CLI process alive for the whole session.
 * Measured: starting a query per turn cost about two seconds before the first
 * token, which in a conversation is two seconds of silence. See
 * `live-session.ts` for why it is a separate object rather than a mode on the
 * reviewer's.
 */
const live = new LiveSession({
  cwd: store.attemptDir(ATTEMPT),
  system: CONVERSATION_SYSTEM,
  disallowedTools: FAST_DISALLOWED,
  onWarning: (message) => emit({ kind: 'warning', message }),
})

/**
 * Authoring runs in its own session, at the workspace root rather than inside an
 * attempt. Writing a scenario has nothing to do with the design under review,
 * and mixing the two would leave the reviewer's context carrying a brief it was
 * never asked about.
 */
const author = new SessionManager({ cwd: workspaceRoot, emit, useKnowledgeServer: false })

const localePath = join(app.getPath('userData'), 'locale')
const fastModePath = join(app.getPath('userData'), 'fast-mode')

/**
 * Off by default. Fast mode is a real trade — see `fast-review.ts` — and the
 * app's whole reason to exist is the quality of the feedback, so it is opted
 * into rather than out of. Stored like the locale, because it is a preference
 * about how you work and not part of any one attempt.
 */
function fastMode(): boolean {
  try {
    return existsSync(fastModePath) && readFileSync(fastModePath, 'utf-8').trim() === 'on'
  } catch {
    return false
  }
}

/**
 * Spanish by default. A stored choice wins; otherwise the OS locale decides,
 * which is what makes this internationalization rather than a translation.
 */
function currentLocale(): Locale {
  try {
    if (existsSync(localePath)) return toLocale(readFileSync(localePath, 'utf-8'))
  } catch {
    // fall through to the OS
  }
  return toLocale(app.getLocale())
}

/**
 * App-owned files (the skill, CLAUDE.md) are refreshed on every launch, so a new
 * app version ships a new rubric. Scenarios and attempts belong to the user and
 * are never overwritten.
 */
async function scaffoldWorkspace(): Promise<void> {
  await mkdir(store.attemptDir(ATTEMPT), { recursive: true })
  if (!existsSync(templateRoot)) return

  await cp(join(templateRoot, 'CLAUDE.md'), join(workspaceRoot, 'CLAUDE.md'), { force: true })
  await cp(join(templateRoot, '.claude'), join(workspaceRoot, '.claude'), { recursive: true, force: true })
  // The scenarios the app ships are app content: they carry the rubric the
  // reviewer grades against and the localized briefs, so a new app version has
  // to be able to update them. Scenarios the user adds are never touched,
  // because nothing here removes files that the template does not contain.
  await cp(join(templateRoot, 'scenarios'), join(workspaceRoot, 'scenarios'), {
    recursive: true,
    force: true,
  })

  const references = join(templateRoot, 'references')
  if (existsSync(references)) {
    await cp(references, join(workspaceRoot, 'references'), { recursive: true, force: true })
  }
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: '#f8f9fa',
    title: 'Kaze',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // The renderer draws diagrams. It has no business holding the filesystem,
      // the SDK session, or (from Phase 5) the OpenAI key.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  // The renderer needs the microphone and nothing else. Everything not asked
  // for here is denied rather than left to Chromium's defaults.
  win.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media')
  })

  win.once('ready-to-show', () => win?.show())
  win.on('closed', () => {
    win = null
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

ipcMain.handle('design:save', async (_e, diagram: Diagram) => ({
  path: await store.saveDiagram(diagram, ATTEMPT),
}))

ipcMain.handle('design:load', async () => store.loadDiagram(ATTEMPT))

ipcMain.handle('design:snapshot', async (_e, diagram: Diagram) => store.snapshotRevision(diagram, ATTEMPT))

ipcMain.handle('workspace:path', () => store.root)

ipcMain.handle('scenario:list', () => listScenarios(workspaceRoot, currentLocale()))

ipcMain.handle('scenario:reveal', () => shell.openPath(join(workspaceRoot, 'scenarios')))

ipcMain.handle('scenario:cancel', () => author.cancel())

ipcMain.handle(
  'scenario:create',
  async (_e, topic: string, difficulty: number): Promise<{ id: string } | { error: string }> => {
    const locale = currentLocale()
    const reply = await author.send(authorPrompt(topic, difficulty, locale), 'ask')
    const parsed = parseAuthored(reply)
    if ('error' in parsed) return parsed
    const { id } = await writeScenario(workspaceRoot, parsed.markdown, topic)
    return { id }
  },
)

/**
 * Photographs a rectangle of the window and puts it on the clipboard.
 *
 * `capturePage` asks the compositor for what it already drew, so anything
 * visible is in the picture by construction. The DOM-rasterising libraries do
 * not manage that here: React Flow paints each edge in a small <svg> that
 * spills outside its own box, which survives on screen and vanishes on
 * rasterisation — the first attempts produced every node and not one
 * connection.
 *
 * The clipboard is written here rather than with navigator.clipboard because
 * the renderer is sandboxed and served from file://, where the async clipboard
 * API is gated behind permissions it will not reliably get.
 */
ipcMain.handle(
  'canvas:capture',
  async (_e, rect: { x: number; y: number; width: number; height: number }) => {
    if (!win) throw new Error('no window')
    const image = await win.webContents.capturePage({
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    })
    if (image.isEmpty()) throw new Error('the captured image was empty')
    clipboard.writeImage(image)
    const size = image.getSize()
    return { width: size.width, height: size.height }
  },
)

ipcMain.handle('clipboard:write-text', (_e, text: string) => {
  clipboard.writeText(text)
})

ipcMain.handle('locale:get', () => currentLocale())
ipcMain.handle('locale:set', async (_e, locale: Locale) => {
  await writeFile(localePath, locale, 'utf-8')
})

ipcMain.handle('mode:get-fast', () => fastMode())
ipcMain.handle('mode:set-fast', async (_e, on: boolean) => {
  await writeFile(fastModePath, on ? 'on' : 'off', 'utf-8')
})

ipcMain.handle('review:cancel', () => session.cancel())

/**
 * Put the attempt aside and start clean: a fresh conversation, an empty
 * diagram, an empty ledger. The old attempt is moved rather than deleted, so
 * what you designed and how it was reviewed stays on disk.
 */
ipcMain.handle('attempt:new', async () => {
  const t = dict(currentLocale())
  const { response } = await dialog.showMessageBox(win!, {
    type: 'question',
    buttons: [t.newSessionConfirm, t.newSessionCancel],
    defaultId: 0,
    cancelId: 1,
    message: t.newSessionTitle,
    detail: t.newSessionDetail,
  })
  if (response !== 0) return { cancelled: true as const }

  session.reset()
  const archivedTo = await store.archiveAttempt(ATTEMPT)
  await store.writeMeta({ createdAt: new Date().toISOString() }, ATTEMPT)
  return { archivedTo: archivedTo ?? '' }
})

/**
 * Ask for the change one finding calls for, as operations rather than as a new
 * design. The model proposes; the renderer validates and applies. Letting it
 * hand back a whole diagram would make every fix an unreviewable rewrite, and
 * would quietly move the thing being graded out from under the person
 * practising.
 */
ipcMain.handle('review:fix', async (_e, claim: string, fix: string): Promise<PatchOp[]> => {
  const locale = currentLocale()
  const prompt = `Read design.md. Apply exactly this one finding, and nothing else:

FINDING: ${claim}
SUGGESTED FIX: ${fix}

Reply with ONE fenced json block holding an array of operations and no other
text. The available operations, and their only shapes:

  { "op": "set_props", "node": "n5", "props": { "multi_az": true } }
  { "op": "add_node", "service": "ElastiCache", "label": "cache", "near": "n3", "as": "cache" }
  { "op": "add_boundary", "kind": "az", "label": "eu-west-1b", "as": "azb" }
  { "op": "add_edge", "from": "n3", "to": "cache", "protocol": "RESP" }
  { "op": "remove_edge", "from": "n3", "to": "n5" }
  { "op": "set_protocol", "from": "n2", "to": "n3", "protocol": "HTTPS" }
  { "op": "move_node", "node": "n9", "into": "azb" }

Rules: use the exact service ids and property keys from design.md; \`as\` names
something you add so later operations can reference it; \`from\` initiates and
\`to\` receives. Do not delete nodes and do not restructure anything the finding
did not ask about. Make the smallest change that answers it.

${REPLY_LANGUAGE[locale]}`

  const reply = await session.send(prompt, 'ask')
  return parsePatch(lastFencedJson(reply))
})

ipcMain.handle('voice:has-key', () => voice.hasKey())
ipcMain.handle('voice:set-key', (_e, key: string) => voice.setKey(key))
ipcMain.handle('voice:transcribe', (_e, audio: ArrayBuffer, mimeType: string) =>
  // Telling the transcriber the language roughly halves the error rate on
  // Spanish, and stops "revisa" coming back as "review".
  voice.transcribe(audio, mimeType, SPEECH_LANGUAGE[currentLocale()]),
)

ipcMain.handle(
  'review:run',
  async (_e, diagram: Diagram, intent: TurnIntent, question?: string): Promise<ReviewOutcome> => {
    const locale = currentLocale()
    const fast = fastMode()

    // A question about the current state still needs the design on disk to be
    // current, but only a review earns a revision number.
    if (intent !== 'review') {
      await store.saveDiagram(diagram, ATTEMPT)
      const ledger = await store.loadLedger(ATTEMPT)
      const asked = question ?? 'What do you make of the current design?'
      const answer = fast
        ? await session.send(
            fastAskPrompt(await fastContext(diagram, undefined, null, ledger, locale), asked),
            'ask',
            // Not `fresh`: a question continues whatever the last fast turn
            // said, which is what makes "and why?" work.
            { system: FAST_ASK_SYSTEM, key: REVIEW_CHAT },
          )
        : await session.send(`${asked}

${REPLY_LANGUAGE[locale]}`, 'ask')
      return {
        intent,
        // The skill has been used all session, so the model often appends a
        // findings block out of habit even when only asked a question. Strip
        // it: it is machinery, and a question never touches the ledger.
        markdown: parseReview(answer).markdown,
        payload: null,
        problem: null,
        revision: null,
        // A question never disturbs the ledger, but the panel still shows it.
        ledger,
        // An answer is spoken too — otherwise asking by voice gets a silent reply.
        audio: await speakIfPossible(answer.trim(), VoiceService.audioPath(store.attemptDir(ATTEMPT), 0)),
      }
    }

    const snapshot = await store.snapshotRevision(diagram, ATTEMPT)
    let ledger = await store.loadLedger(ATTEMPT)
    // `fresh` on a fast review: each one is a judgement of the design as it
    // stands now, and the continuity that matters between revisions is the
    // ledger, which is written into the prompt. That also keeps the tenth
    // review as quick as the first.
    const turn = fast ? { system: FAST_REVIEW_SYSTEM, key: REVIEW_CHAT, fresh: true } : undefined
    const text = fast
      ? await session.send(
          fastReviewPrompt(
            await fastContext(diagram, snapshot.revision, snapshot.diff, ledger, locale),
          ),
          'review',
          turn,
        )
      : await session.send(reviewPrompt(diagram.scenarioId, snapshot.revision, locale), 'review')
    let parsed = parseReview(text)

    if (!parsed.payload) {
      // One corrective turn before degrading to markdown-only. Cheap, and it
      // rescues the common case of a reply that trails off after the block.
      emit({ kind: 'warning', message: dict(locale).askingAgain(dict(locale)[parsed.problem === 'no-block' ? 'noFindingsBlock' : 'notAPayload']) })
      // Continues the turn it is repairing, so `fresh` is deliberately dropped.
      const repair = await session.send(REPAIR_PROMPT, 'review', fast ? { system: FAST_REVIEW_SYSTEM, key: REVIEW_CHAT } : undefined)
      const repaired = parseReview(repair)
      if (repaired.payload) parsed = { ...parsed, payload: repaired.payload, problem: null }
    }

    if (parsed.payload) {
      ledger = reconcile(ledger, parsed.payload, snapshot.revision)
      await store.saveLedger(ledger, ATTEMPT)
    }
    const audio = parsed.payload?.spoken_summary
      ? await speakIfPossible(
          parsed.payload.spoken_summary,
          VoiceService.audioPath(store.attemptDir(ATTEMPT), snapshot.revision),
        )
      : null

    return { intent, ...parsed, revision: snapshot.revision, ledger, audio }
  },
)

/**
 * Voice is an enhancement, never a dependency: no key, a network failure or a
 * bad response must leave the written review intact.
 */
async function speakIfPossible(text: string, path: string): Promise<string | null> {
  if (!text) return null
  try {
    if (!(await voice.hasKey())) return null
    return (await voice.speak(text, path)).data
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    emit({ kind: 'warning', message: dict(currentLocale()).couldNotSpeak(reason) })
    return null
  }
}

/**
 * Conversation mode.
 *
 * `chat:open` frames the case and draws nothing; `chat:say` is one exchange.
 * Both run one fast turn and hand back three things: what to say, what to draw,
 * and the audio.
 *
 * The speech is started the instant the spoken half of the reply is finished,
 * while the operations are still arriving. That is roughly two seconds of a
 * seven-second turn, and in a conversation two seconds of silence is the
 * difference between talking to something and waiting for it.
 */
let chatAudioSeq = 0

/**
 * Speak a line of the conversation, streaming it to the renderer as it is
 * generated rather than handing over a finished file.
 *
 * Voice stays an enhancement: no key, or a network failure, and the turn still
 * lands with its text and its operations.
 */
async function speakInto(text: string, seq: number): Promise<void> {
  if (!text) return
  try {
    if (!(await voice.hasKey())) return
    await voice.speakStreaming(text, (chunk) => {
      win?.webContents.send('chat:audio', { seq, chunk: Buffer.from(chunk).toString('base64') })
    })
  } catch (err) {
    emit({ kind: 'warning', message: dict(currentLocale()).couldNotSpeak(err instanceof Error ? err.message : String(err)) })
  } finally {
    win?.webContents.send('chat:audio', { seq, chunk: null })
  }
}

async function chatTurn(prompt: string, fresh: boolean): Promise<ChatTurn> {
  if (fresh) live.close()
  const seq = ++chatAudioSeq
  let spoken: Promise<void> | null = null
  const speak = (text: string) => {
    if (!spoken && text) spoken = speakInto(text, seq)
  }

  emit({ kind: 'turn-start', intent: 'ask' })
  let seen = ''
  let text = ''
  try {
    text = await live.say(prompt, (chunk) => {
      seen += chunk
      emit({ kind: 'delta', text: chunk })
      // The moment the spoken half is finished — while the operations are
      // still arriving — the synthesizer is already working on it.
      if (spokenHalfComplete(seen)) speak(spokenHalf(seen))
    })
  } finally {
    emit({ kind: 'turn-end', intent: 'ask', cancelled: false })
  }

  const say = spokenHalf(text)
  // A reply that never opened a fence is all prose; speak it now.
  speak(say)

  return {
    say,
    audioSeq: seq,
    // Conversation mode is the one place the model may take something out: it
    // drew the box a minute ago, and "quita el balanceador" has to work.
    ops: parsePatch(lastFencedJson(text), { allowRemoveNode: true }),
  }
}

ipcMain.handle('chat:open', async (_e, diagram: Diagram): Promise<ChatTurn> => {
  await store.saveDiagram(diagram, ATTEMPT)
  const locale = currentLocale()
  return chatTurn(
    conversationOpening({
      scenario: await readScenarioSource(workspaceRoot, diagram.scenarioId),
      diagram,
      locale,
    }),
    true,
  )
})

ipcMain.handle('chat:say', (_e, said: string, refused: string[] = []): Promise<ChatTurn> =>
  chatTurn(conversationTurn(said, refused), false),
)

// Leaving the mode lets the process go. Holding a CLI open for a conversation
// nobody is having is the kind of thing you only notice in Task Manager.
ipcMain.handle('chat:close', () => live.close())

/**
 * Everything a fast turn would otherwise have opened a file to read. Assembled
 * here rather than in `fast-review.ts` because this is where the workspace and
 * the store live; that module only knows how to phrase it.
 */
async function fastContext(
  diagram: Diagram,
  revision: number | undefined,
  diff: RevisionResult['diff'] | null,
  ledger: Ledger | null,
  locale: Locale,
): Promise<FastContext> {
  return {
    scenario: await readScenarioSource(workspaceRoot, diagram.scenarioId),
    diagram,
    revision,
    diff,
    ledger,
    locale,
  }
}

const reviewPrompt = (scenarioId: string, revision: number, locale: Locale) =>
  `Use the kaze-review skill. Review revision ${revision} of design.md against scenarios/${scenarioId}.md.

${REPLY_LANGUAGE[locale]}`

void app.whenReady().then(async () => {
  // Continue where the last run left off rather than starting a conversation
  // that has never seen the design it is about to be asked to review.
  session.adopt((await store.readMeta(ATTEMPT)).sessionId)
  // No stock File/Edit/View menu: this is a canvas, not a document editor.
  Menu.setApplicationMenu(null)
  await scaffoldWorkspace()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  live.close()
  session.cancel()
  if (process.platform !== 'darwin') app.quit()
})
