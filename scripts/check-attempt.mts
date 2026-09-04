/**
 * Starting over moves an attempt aside. It is the one operation in the app that
 * touches a whole directory of the user's work, so what it must never do is
 * more interesting than what it does.
 *
 * Run: node scripts/check.mjs scripts/check-attempt.mts
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { WorkspaceStore } from '../src/main/workspace-store.ts'
import type { Diagram } from '../src/shared/types.ts'

const checks: Array<[string, boolean, string?]> = []
const check = (name: string, pass: boolean, detail = '') => checks.push([name, pass, detail])

const root = mkdtempSync(join(tmpdir(), 'kaze-attempt-'))
const store = new WorkspaceStore(root)

const diagram: Diagram = {
  version: 1,
  scenarioId: 'url-shortener',
  groups: [],
  nodes: [{ id: 'n1', serviceId: 'RDS', label: 'db', props: {}, x: 0, y: 0 }],
  edges: [],
}

try {
  // A worked-in attempt: a design, two revisions, a ledger and a session id.
  await store.snapshotRevision(diagram, 'default')
  await store.snapshotRevision({ ...diagram, scenarioId: 'url-shortener' }, 'default')
  await store.saveLedger({ revision: 2, entries: [] }, 'default')
  await store.writeMeta({ sessionId: 'abc-123' }, 'default')
  mkdirSync(join(store.attemptDir('default'), 'audio'), { recursive: true })
  writeFileSync(join(store.attemptDir('default'), 'audio', '001-summary.mp3'), 'x')

  // Scenarios live outside the attempt and must survive untouched.
  mkdirSync(join(root, 'scenarios'), { recursive: true })
  writeFileSync(join(root, 'scenarios', 'mine.md'), '---\nid: mine\n---\n')

  check('the session id is written where a restart can find it',
    (await store.readMeta('default')).sessionId === 'abc-123')

  const archivedTo = await store.archiveAttempt('default')

  check('the attempt is moved somewhere, and the path is reported', typeof archivedTo === 'string' && archivedTo !== '')
  check('nothing is deleted: the design is still in the archive',
    existsSync(join(archivedTo!, 'design.md')))
  check('the revisions come with it', readdirSync(join(archivedTo!, 'revisions')).length === 4,
    String(readdirSync(join(archivedTo!, 'revisions')).length))
  check('so does the ledger and the audio',
    existsSync(join(archivedTo!, 'findings.json')) && existsSync(join(archivedTo!, 'audio', '001-summary.mp3')))
  check('the archived ledger still reads back',
    JSON.parse(readFileSync(join(archivedTo!, 'findings.json'), 'utf-8')).revision === 2)

  check('the live attempt is empty afterwards', readdirSync(store.attemptDir('default')).length === 0,
    readdirSync(store.attemptDir('default')).join(', '))
  check('the new attempt has no diagram', (await store.loadDiagram('default')) === null)
  check('the new attempt has no ledger', (await store.loadLedger('default')) === null)
  check('the new attempt has no session to resume', (await store.readMeta('default')).sessionId === undefined)
  check('the next revision starts from one again',
    (await store.snapshotRevision(diagram, 'default')).revision === 1)

  check('scenarios are untouched: they are not part of an attempt',
    existsSync(join(root, 'scenarios', 'mine.md')))

  // Archiving twice must not collide, and must not swallow the first archive.
  const second = await store.archiveAttempt('default')
  check('a second archive lands beside the first, not on top of it',
    second !== archivedTo && existsSync(join(archivedTo!, 'design.md')), `${archivedTo} vs ${second}`)
  check('archives are kept together under attempts/archive',
    readdirSync(join(root, 'attempts', 'archive')).length === 2)

  // Nothing to archive is not an error; it is the state after archiving.
  rmSync(store.attemptDir('default'), { recursive: true, force: true })
  check('archiving nothing returns nothing rather than throwing',
    (await store.archiveAttempt('default')) === null)

  for (const [name, pass, detail] of checks) {
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
  }
  const failed = checks.filter(([, pass]) => !pass)
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
  assert.equal(failed.length, 0)
} finally {
  rmSync(root, { recursive: true, force: true })
}
