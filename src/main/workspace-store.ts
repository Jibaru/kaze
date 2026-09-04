import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { diffDiagrams, toDesignDocument } from '../shared/adl'
import type { Ledger } from '../shared/ledger'
import { existsSync } from 'node:fs'
import type { AttemptMeta, Diagram, RevisionResult } from '../shared/types'

/**
 * Owns the on-disk workspace. This is also the directory the Claude Code
 * session runs in from Phase 3 onward, which is why the design lives in real
 * files rather than app state: the reviewer reads it off disk.
 */
export class WorkspaceStore {
  readonly root: string

  /** The root is injected rather than read from Electron, so this whole class
   *  runs — and is testable — outside a running app. */
  constructor(root: string) {
    this.root = root
  }

  attemptDir(attemptId: string): string {
    return join(this.root, 'attempts', attemptId)
  }

  diagramPath(attemptId = 'default'): string {
    return join(this.attemptDir(attemptId), 'diagram.json')
  }

  private revisionsDir(attemptId: string): string {
    return join(this.attemptDir(attemptId), 'revisions')
  }

  async saveDiagram(diagram: Diagram, attemptId = 'default'): Promise<string> {
    const path = this.diagramPath(attemptId)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, JSON.stringify(diagram, null, 2), 'utf-8')
    return path
  }

  async loadDiagram(attemptId = 'default'): Promise<Diagram | null> {
    try {
      const raw = await readFile(this.diagramPath(attemptId), 'utf-8')
      const parsed = JSON.parse(raw) as Diagram
      // A save format is a compatibility surface; refuse what we don't
      // understand rather than half-loading it.
      if (parsed?.version !== 1) return null
      return parsed
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
  }

  private metaPath(attemptId: string): string {
    return join(this.attemptDir(attemptId), 'meta.json')
  }

  /**
   * What the app needs to pick an attempt back up, chiefly the Claude session
   * id. Without it every launch silently starts a fresh conversation while the
   * reviewer still reads the accumulated ledger off disk — a new reviewer with
   * an old case file, which is the worst of both.
   */
  async readMeta(attemptId = 'default'): Promise<AttemptMeta> {
    try {
      return JSON.parse(await readFile(this.metaPath(attemptId), 'utf-8')) as AttemptMeta
    } catch {
      return {}
    }
  }

  async writeMeta(meta: AttemptMeta, attemptId = 'default'): Promise<void> {
    await mkdir(this.attemptDir(attemptId), { recursive: true })
    await writeFile(this.metaPath(attemptId), JSON.stringify(meta, null, 2), 'utf-8')
  }

  /**
   * Put the current attempt aside and start an empty one.
   *
   * Moved rather than deleted: an attempt is a record of what you designed and
   * what it was reviewed as, and a button that throws that away is a button
   * people are right to distrust.
   */
  async archiveAttempt(attemptId = 'default'): Promise<string | null> {
    const from = this.attemptDir(attemptId)
    if (!existsSync(from)) return null

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const archive = join(this.root, 'attempts', 'archive')
    await mkdir(archive, { recursive: true })

    // The stamp is only accurate to the second, so two archives in a row can
    // ask for the same name. Left alone, the copy-then-remove path would merge
    // one attempt into the other and quietly mix two designs.
    let to = join(archive, `${attemptId}-${stamp}`)
    for (let n = 2; existsSync(to); n++) to = join(archive, `${attemptId}-${stamp}-${n}`)

    try {
      await rename(from, to)
    } catch (err) {
      // Renaming a directory on Windows fails with EPERM whenever anything
      // still holds a handle inside it — an audio file the app just wrote, a
      // virus scanner reading it. Copy-then-remove is slower and survives that,
      // and the copy completes before anything is removed, so a failure here
      // leaves the attempt where it was rather than half-moved.
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EXDEV') throw err
      await cp(from, to, { recursive: true })
      await rm(from, { recursive: true, force: true })
    }

    await mkdir(from, { recursive: true })
    return to
  }

  ledgerPath(attemptId = 'default'): string {
    return join(this.attemptDir(attemptId), 'findings.json')
  }

  /**
   * The ledger the review skill is told to read first. It lives on disk rather
   * than in the conversation, which is what makes mid-attempt auto-compaction
   * harmless: the state survives a compacted context.
   */
  async loadLedger(attemptId = 'default'): Promise<Ledger | null> {
    try {
      const parsed = JSON.parse(await readFile(this.ledgerPath(attemptId), 'utf-8')) as Ledger
      return Array.isArray(parsed?.entries) ? parsed : null
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
  }

  async saveLedger(ledger: Ledger, attemptId = 'default'): Promise<string> {
    const path = this.ledgerPath(attemptId)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, JSON.stringify(ledger, null, 2), 'utf-8')
    return path
  }

  /** Revision numbers already on disk, ascending. */
  private async revisionNumbers(attemptId: string): Promise<number[]> {
    try {
      const files = await readdir(this.revisionsDir(attemptId))
      return files
        .map((f) => /^(\d+)-design\.md$/.exec(f))
        .filter((m): m is RegExpExecArray => m !== null)
        .map((m) => Number(m[1]))
        .sort((a, b) => a - b)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw err
    }
  }

  private async loadRevisionDiagram(attemptId: string, revision: number): Promise<Diagram | null> {
    try {
      const raw = await readFile(join(this.revisionsDir(attemptId), `${pad(revision)}-diagram.json`), 'utf-8')
      return JSON.parse(raw) as Diagram
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
  }

  /**
   * Snapshot the current design as the next numbered revision and refresh
   * `design.md`. The JSON alongside each revision is what makes the *next*
   * diff computable — a diff derived from prose would be guesswork.
   */
  async snapshotRevision(diagram: Diagram, attemptId = 'default'): Promise<RevisionResult> {
    const numbers = await this.revisionNumbers(attemptId)
    const previousNumber = numbers.at(-1) ?? null
    const previous = previousNumber === null ? null : await this.loadRevisionDiagram(attemptId, previousNumber)
    const revision = (previousNumber ?? 0) + 1

    const diff = diffDiagrams(previous, diagram)
    const document = toDesignDocument(diagram, { revision, diff })

    const dir = this.revisionsDir(attemptId)
    await mkdir(dir, { recursive: true })
    const revisionPath = join(dir, `${pad(revision)}-design.md`)
    await writeFile(revisionPath, document, 'utf-8')
    await writeFile(join(dir, `${pad(revision)}-diagram.json`), JSON.stringify(diagram, null, 2), 'utf-8')

    // `design.md` is the stable path the reviewer is told to read; revisions are
    // there for "what did I have before the queue?".
    const designPath = join(this.attemptDir(attemptId), 'design.md')
    await writeFile(designPath, document, 'utf-8')
    await this.saveDiagram(diagram, attemptId)

    return { revision, designPath, revisionPath, diff, document }
  }
}

const pad = (n: number): string => String(n).padStart(3, '0')
