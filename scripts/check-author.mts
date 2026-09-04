/**
 * Authoring a scenario takes model output and turns it into a filename and a
 * file. Both halves are worth pinning down: a scenario with no rubric cannot be
 * graded, and a filename that comes from generated text must never be able to
 * point anywhere but the scenarios folder.
 *
 * Run: node scripts/check.mjs scripts/check-author.mts
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseAuthored, slugify, writeScenario } from '../src/main/scenario-author.ts'

const checks: Array<[string, boolean, string?]> = []
const check = (name: string, pass: boolean, detail = '') => checks.push([name, pass, detail])

const FILE = `---
id: seat-booking
title: Seat booking
difficulty: 2
---

## Brief

Design seat booking for cinemas.

<!-- RUBRIC:START -->

## Rubric

1. Where the mutual exclusion lives.

<!-- RUBRIC:END -->
`

const fenced = (body: string, lang = 'markdown') => '```' + lang + '\n' + body + '\n```'

// ── parsing ───────────────────────────────────────────────────────────────
const ok = parseAuthored(`Here you go.\n\n${fenced(FILE)}`)
check('extracts the file from a reply', 'markdown' in ok && ok.markdown.includes('id: seat-booking'))
check('keeps the rubric in the file', 'markdown' in ok && ok.markdown.includes('RUBRIC:START'))

const untagged = parseAuthored(fenced(FILE, ''))
check('accepts an untagged fence', 'markdown' in untagged)

// A reply that shows the template before filling it in must not win.
const twoBlocks = parseAuthored(
  `The shape is:\n\n${fenced('---\nid: example\n---\n\n## Brief')}\n\nHere it is:\n\n${fenced(FILE)}`,
)
check('takes the block that actually has a rubric', 'markdown' in twoBlocks && twoBlocks.markdown.includes('seat-booking'))

// Refusals: a scenario that cannot be graded must not be written.
check('refuses a reply with no block', 'error' in parseAuthored('Sure, here is a scenario about cinemas.'))
check('refuses a file with no frontmatter',
  'error' in parseAuthored(fenced('## Brief\n\nSomething.\n\n<!-- RUBRIC:START -->\n\n1. x\n\n<!-- RUBRIC:END -->')))
const noRubric = parseAuthored(fenced('---\nid: x\ntitle: X\n---\n\n## Brief\n\nSomething.'))
check('refuses a file with no rubric', 'error' in noRubric && noRubric.error === 'no-rubric',
  'error' in noRubric ? noRubric.error : 'accepted')

// ── slugs: this becomes a filename ────────────────────────────────────────
check('slugifies accents and spaces', slugify('Reserva de Asientos de Ciné') === 'reserva-de-asientos-de-cine',
  slugify('Reserva de Asientos de Ciné'))
check('strips path traversal', slugify('../../etc/passwd') === 'etc-passwd', slugify('../../etc/passwd'))
check('strips separators entirely', !slugify('a/b\\c:d').includes('/') && !slugify('a/b\\c:d').includes('\\'),
  slugify('a/b\\c:d'))
check('never returns an empty name', slugify('///') === 'scenario', slugify('///'))
check('caps the length', slugify('x'.repeat(200)).length <= 48, String(slugify('x'.repeat(200)).length))

// ── writing ───────────────────────────────────────────────────────────────
const root = mkdtempSync(join(tmpdir(), 'kaze-author-'))
mkdirSync(join(root, 'scenarios'))
try {
  const first = await writeScenario(root, FILE, 'Seat booking')
  check('writes under the declared id', first.id === 'seat-booking', first.id)
  check('the file lands in the scenarios folder', readdirSync(join(root, 'scenarios')).includes('seat-booking.md'))

  // The review prompt addresses `scenarios/<id>.md`, so the two must agree.
  const second = await writeScenario(root, FILE, 'Seat booking')
  check('a second scenario with the same id does not clobber the first', second.id === 'seat-booking-2', second.id)
  check('the frontmatter id is rewritten to match the filename',
    readFileSync(second.path, 'utf-8').includes('id: seat-booking-2'))
  check('the first file is untouched', readFileSync(first.path, 'utf-8').includes('id: seat-booking\n'))

  // A file with no declared id still has to end up addressable.
  const bare = await writeScenario(root, '---\ntitle: No id here\n---\n\n## Brief\n', 'Ticket queue')
  check('an undeclared id is derived and inserted', bare.id === 'ticket-queue' &&
    readFileSync(bare.path, 'utf-8').includes('id: ticket-queue'), bare.id)

  const escaped = await writeScenario(root, '---\nid: ../../escape\ntitle: X\n---\n', 'X')
  check('a traversing id is neutralised before it becomes a path',
    escaped.id === 'escape' && escaped.path.endsWith(join('scenarios', 'escape.md')), escaped.id)

  for (const [name, pass, detail] of checks) {
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
  }
  const failed = checks.filter(([, pass]) => !pass)
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
  assert.equal(failed.length, 0)
} finally {
  rmSync(root, { recursive: true, force: true })
}
