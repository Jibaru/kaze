import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron'
import { cp, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { WorkspaceStore } from './workspace-store'
import { SessionManager } from './session-manager'
import { VoiceService } from './voice-service'
import { listScenarios } from './scenarios'
import { parseReview, REPAIR_PROMPT } from '../shared/findings'
import { reconcile } from '../shared/ledger'
import type { Diagram, ReviewEvent, ReviewOutcome, TurnIntent } from '../shared/types'

const ATTEMPT = 'default'

const workspaceRoot = join(app.getPath('userData'), 'workspace')
const store = new WorkspaceStore(workspaceRoot)

/** The template shipped with the app: CLAUDE.md, the skill, the scenario bank. */
const templateRoot = app.isPackaged
  ? join(process.resourcesPath, 'workspace')
  : join(__dirname, '../../workspace')

let win: BrowserWindow | null = null
const emit = (event: ReviewEvent) => win?.webContents.send('review:event', event)

const session = new SessionManager({ cwd: store.attemptDir(ATTEMPT), emit })
const voice = new VoiceService(join(app.getPath('userData'), 'openai.key'))

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
  await cp(join(templateRoot, 'scenarios'), join(workspaceRoot, 'scenarios'), {
    recursive: true,
    force: false,
    errorOnExist: false,
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
    backgroundColor: '#0d1117',
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

ipcMain.handle('scenario:list', () => listScenarios(workspaceRoot))

ipcMain.handle('review:cancel', () => session.cancel())

ipcMain.handle('voice:has-key', () => voice.hasKey())
ipcMain.handle('voice:set-key', (_e, key: string) => voice.setKey(key))
ipcMain.handle('voice:transcribe', (_e, audio: ArrayBuffer, mimeType: string) =>
  voice.transcribe(audio, mimeType),
)

ipcMain.handle(
  'review:run',
  async (_e, diagram: Diagram, intent: TurnIntent, question?: string): Promise<ReviewOutcome> => {
    // A question about the current state still needs the design on disk to be
    // current, but only a review earns a revision number.
    if (intent !== 'review') {
      await store.saveDiagram(diagram, ATTEMPT)
      const answer = await session.send(question ?? 'What do you make of the current design?', 'ask')
      return {
        intent,
        markdown: answer.trim(),
        payload: null,
        problem: null,
        revision: null,
        // A question never disturbs the ledger, but the panel still shows it.
        ledger: await store.loadLedger(ATTEMPT),
        // An answer is spoken too — otherwise asking by voice gets a silent reply.
        audio: await speakIfPossible(answer.trim(), 0),
      }
    }

    const snapshot = await store.snapshotRevision(diagram, ATTEMPT)
    const text = await session.send(reviewPrompt(diagram.scenarioId, snapshot.revision), 'review')
    let parsed = parseReview(text)

    if (!parsed.payload) {
      // One corrective turn before degrading to markdown-only. Cheap, and it
      // rescues the common case of a reply that trails off after the block.
      emit({ kind: 'warning', message: `${parsed.problem} — asking for it again` })
      const repair = await session.send(REPAIR_PROMPT, 'review')
      const repaired = parseReview(repair)
      if (repaired.payload) parsed = { ...parsed, payload: repaired.payload, problem: null }
    }

    let ledger = await store.loadLedger(ATTEMPT)
    if (parsed.payload) {
      ledger = reconcile(ledger, parsed.payload, snapshot.revision)
      await store.saveLedger(ledger, ATTEMPT)
    }
    const audio = parsed.payload?.spoken_summary
      ? await speakIfPossible(parsed.payload.spoken_summary, snapshot.revision)
      : null

    return { intent, ...parsed, revision: snapshot.revision, ledger, audio }
  },
)

/**
 * Voice is an enhancement, never a dependency: no key, a network failure or a
 * bad response must leave the written review intact.
 */
async function speakIfPossible(text: string, revision: number): Promise<string | null> {
  if (!text) return null
  try {
    if (!(await voice.hasKey())) return null
    const path = VoiceService.audioPath(store.attemptDir(ATTEMPT), revision)
    return (await voice.speak(text, path)).data
  } catch (err) {
    emit({ kind: 'warning', message: `could not speak the summary: ${err instanceof Error ? err.message : err}` })
    return null
  }
}

const reviewPrompt = (scenarioId: string, revision: number) =>
  `Use the kaze-review skill. Review revision ${revision} of design.md against scenarios/${scenarioId}.md.`

void app.whenReady().then(async () => {
  // No stock File/Edit/View menu: this is a canvas, not a document editor.
  Menu.setApplicationMenu(null)
  await scaffoldWorkspace()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  session.cancel()
  if (process.platform !== 'darwin') app.quit()
})
