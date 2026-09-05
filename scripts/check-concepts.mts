/**
 * The concept bank, checked against itself.
 *
 * Two things here can go wrong quietly, which is why they are checked rather
 * than trusted:
 *
 *   - **The step count is shown as a fact.** The bar says "paso 3 de 6" because
 *     the file said six. Add a seventh idea and forget the frontmatter and the
 *     app is lying to the learner about how far in they are.
 *   - **The checks are hidden.** A concept's questions and its common wrong
 *     answers are the answer key, exactly like a scenario's rubric. If one ever
 *     reaches the renderer, studying becomes rehearsing.
 *
 * Run: node scripts/check.mjs scripts/check-concepts.mts
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { listConcepts, readConceptSource } from '../src/main/scenarios.ts'
import { getService } from '../src/shared/services.ts'

const checks: Array<[string, boolean, string?]> = []
const check = (name: string, pass: boolean, detail = '') => checks.push([name, pass, detail])

/** The bank that ships with the app, not a fixture: these are the real files. */
const root = 'workspace'
const dir = join(root, 'concepts')
const files = readdirSync(dir).filter((f) => f.endsWith('.md'))

check('the app ships concepts to study', files.length > 0, `${files.length} files`)

const seen = new Set<string>()

for (const file of files) {
  const raw = readFileSync(join(dir, file), 'utf-8').replace(/\r\n/g, '\n')
  const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(raw)
  const name = file.replace(/\.md$/, '')

  if (!frontmatter) {
    check(`${name}: has frontmatter`, false)
    continue
  }

  const meta = Object.fromEntries(
    frontmatter[1]!
      .split('\n')
      .map((line) => /^([a-z_]+):\s*(.*)$/.exec(line.trim()))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => [m[1]!, m[2]!]),
  )
  const body = raw.slice(frontmatter[0].length)

  check(`${name}: its id matches its filename`, meta.id === name, meta.id)
  check(`${name}: the id is not already taken`, !seen.has(meta.id!))
  seen.add(meta.id!)

  // The service is a hint the lesson draws from, so a typo means it reaches for
  // a box the manifest does not have and the app refuses it mid-lesson.
  check(`${name}: names a service the manifest knows`, getService(meta.service ?? '') !== undefined, meta.service)

  check(`${name}: has a Spanish title, since that is the default interface`, Boolean(meta.title_es))

  // The count the bar displays has to be the number of ideas actually listed.
  const ideas = (body.match(/^\d+\. \*\*/gm) ?? []).length
  check(`${name}: its step count is the number of ideas it lists`, Number(meta.steps) === ideas,
    `says ${meta.steps}, lists ${ideas}`)

  check(`${name}: has checks to ask`, /<!--\s*CHECKS:START[\s\S]*?CHECKS:END\s*-->/.test(body))
  check(`${name}: names the wrong answers, not only the right ones`,
    /wrong answers/i.test(body))
}

// ── the hidden half ────────────────────────────────────────────────────────
const listed = await listConcepts(root, 'es')
check('every file is listed', listed.length === files.length, `${listed.length} of ${files.length}`)
check('the list is ordered by difficulty, so the first one is a place to start',
  listed.every((c, i) => i === 0 || c.difficulty >= listed[i - 1]!.difficulty),
  listed.map((c) => c.difficulty).join(', '))
check('titles come back in Spanish, the default interface language',
  listed.some((c) => /[áéíóúñ¿]/i.test(c.title)), listed.map((c) => c.title).join(' | '))

check('no concept hands the learner its questions',
  listed.every((c) => !/CHECKS|Check they actually|wrong answers/i.test(c.summary)),
  listed.find((c) => /CHECKS/i.test(c.summary))?.id ?? '')

// …and the main process keeps them, or the lesson has nothing to ask.
const source = await readConceptSource(root, listed[0]!.id)
assert.ok(source, 'the first concept should read back')
check('the main process still gets the checks', /Check they actually understood/.test(source.text))
check('and the markers are stripped, so it reads as prose',
  !source.text.includes('CHECKS:START'))
check('a concept that is not there is null, not a throw',
  (await readConceptSource(root, 'nope')) === null)

for (const [name, pass, detail] of checks) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}
const failed = checks.filter(([, pass]) => !pass)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
assert.equal(failed.length, 0)
