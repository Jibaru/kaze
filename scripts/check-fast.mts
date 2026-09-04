/**
 * Fast mode is a promise about what a turn does NOT do: it opens no files, it
 * calls no tools, and it still knows everything the slow path would have read.
 * That promise lives in a prompt and a toolset, so this is where it is held to.
 *
 * Run: node scripts/check.mjs scripts/check-fast.mts
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readScenarioSource, listScenarios } from '../src/main/scenarios.ts'
import {
  fastReviewPrompt,
  fastAskPrompt,
  FAST_REVIEW_SYSTEM,
  FAST_ASK_SYSTEM,
  type FastContext,
} from '../src/main/fast-review.ts'
import type { Diagram } from '../src/shared/types.ts'
import type { Ledger } from '../src/shared/ledger.ts'

const checks: Array<[string, boolean, string?]> = []
const check = (name: string, pass: boolean, detail = '') => checks.push([name, pass, detail])

const root = mkdtempSync(join(tmpdir(), 'kaze-fast-'))
mkdirSync(join(root, 'scenarios'), { recursive: true })

// Written with CRLF on purpose: scenario files are edited by hand on Windows,
// and that is what has broken the marker regexes before.
writeFileSync(
  join(root, 'scenarios', 'shortener.md'),
  [
    '---',
    'id: shortener',
    'title: URL shortener',
    'title_es: Acortador',
    'difficulty: 2',
    '---',
    '',
    '## Brief',
    '',
    'Design a URL shortener. CANONICAL-BRIEF',
    '',
    '<!-- BRIEF:es -->',
    '',
    '## Enunciado',
    '',
    'Diseña un acortador. TRADUCCION',
    '',
    '<!-- /BRIEF:es -->',
    '',
    '<!-- RUBRIC:START — hidden from the practitioner -->',
    '',
    '## Rubric',
    '',
    '1. RUBRIC-POINT-ONE',
    '',
    '<!-- RUBRIC:END -->',
    '',
  ].join('\r\n'),
  'utf-8',
)

const diagram: Diagram = {
  version: 1,
  scenarioId: 'shortener',
  groups: [],
  nodes: [
    { id: 'n1', serviceId: 'ALB', label: 'edge', props: {}, x: 0, y: 0 },
    { id: 'n2', serviceId: 'RDS', label: 'urls', props: {}, x: 200, y: 0 },
  ],
  edges: [{ id: 'e1', from: 'n1', to: 'n2', protocol: 'SQL' }],
}

const ledger: Ledger = {
  revision: 3,
  entries: [
    {
      id: 'f-open-one',
      status: 'open',
      severity: 'high',
      pillar: 'reliability',
      bp_id: null,
      nodes: ['n2'],
      claim: 'OPEN-CLAIM-TEXT',
      fix: 'Turn on multi-AZ.',
      firstSeenRevision: 1,
      lastSeenRevision: 3,
    },
    {
      id: 'f-regressed',
      status: 'regressed',
      severity: 'medium',
      pillar: 'cost',
      bp_id: null,
      nodes: [],
      claim: 'REGRESSED-CLAIM',
      fix: 'Cache it.',
      firstSeenRevision: 1,
      lastSeenRevision: 3,
    },
    {
      id: 'f-done',
      status: 'resolved',
      severity: 'low',
      pillar: 'security',
      bp_id: null,
      nodes: ['n1'],
      claim: 'RESOLVED-CLAIM',
      fix: 'Terminate TLS.',
      firstSeenRevision: 1,
      lastSeenRevision: 2,
    },
  ],
}

try {
  const source = await readScenarioSource(root, 'shortener')
  assert.ok(source, 'the fixture scenario should read back')

  check('the rubric is handed over: fast mode is the one place it is', source.text.includes('RUBRIC-POINT-ONE'))
  check('CRLF does not stop the frontmatter matching', source.title === 'URL shortener' && source.difficulty === 2)
  check('the canonical brief is kept', source.text.includes('CANONICAL-BRIEF'))
  check('the localized copy is dropped rather than paid for twice', !source.text.includes('TRADUCCION'))
  check(
    'the rubric markers go with it, so the prose reads as prose',
    !source.text.includes('RUBRIC:START') && !source.text.includes('RUBRIC:END'),
  )
  check('a scenario that is not there is null, not a throw', (await readScenarioSource(root, 'nope')) === null)

  // The rubric must never reach the renderer by the ordinary route.
  const listed = await listScenarios(root, 'es')
  check('the panel still never sees the rubric', !listed[0]!.brief.includes('RUBRIC-POINT-ONE'))
  check('and the panel still gets the Spanish brief', listed[0]!.brief.includes('TRADUCCION'))

  const ctx: FastContext = { scenario: source, diagram, revision: 4, diff: null, ledger, locale: 'es' }
  const prompt = fastReviewPrompt(ctx)

  check('the scenario is in the prompt, so nothing has to open it', prompt.includes('CANONICAL-BRIEF'))
  check('so is the rubric it is judged against', prompt.includes('RUBRIC-POINT-ONE'))
  check('so is the design', prompt.includes('n1') && prompt.includes('RDS'))
  check('including the gaps the app computed', prompt.includes('gaps:'))
  check('the revision is named', prompt.includes('revision: 4'))
  check(
    'open findings come with their ids, so they can be reused',
    prompt.includes('f-open-one') && prompt.includes('OPEN-CLAIM-TEXT'),
  )
  check('a regressed finding is still open', prompt.includes('f-regressed'))
  check(
    'a resolved one is not re-listed, or it invites being raised again',
    !prompt.includes('f-done') && !prompt.includes('RESOLVED-CLAIM'),
  )
  check('the reply language is stated', prompt.includes('español'))

  const clean = fastReviewPrompt({ ...ctx, ledger: null })
  check('no ledger says so rather than showing an empty list', clean.includes('None —'))

  const missing = fastReviewPrompt({ ...ctx, scenario: null })
  check(
    'a missing scenario is admitted, not silently reviewed against nothing',
    missing.includes('None on file') && !missing.includes('CANONICAL-BRIEF'),
  )

  const ask = fastAskPrompt({ ...ctx, revision: undefined }, 'ASKED-THIS')
  check('a question carries the same design', ask.includes('RDS'))
  check('and the question itself', ask.includes('ASKED-THIS'))
  check('a question earns no revision number', !ask.includes('revision:'))

  // The contract the app parses back out has to survive being restated here.
  const FENCE = '`'.repeat(3)
  check(
    'the review system prompt still asks for the json block',
    FAST_REVIEW_SYSTEM.includes(FENCE + 'json') && FAST_REVIEW_SYSTEM.includes('spoken_summary'),
  )
  check(
    'it holds the ledger discipline the skill holds',
    FAST_REVIEW_SYSTEM.includes('reuse those exact ids') && FAST_REVIEW_SYSTEM.includes('resolved'),
  )
  check('it keeps the rubric hidden', FAST_REVIEW_SYSTEM.includes('never quote the rubric'))
  check('and it says the gaps are suspects, not findings', FAST_REVIEW_SYSTEM.includes('suspects'))
  check(
    'an answer emits no findings block: a question never touches the ledger',
    FAST_ASK_SYSTEM.includes('do not emit a json block') && !FAST_ASK_SYSTEM.includes(FENCE + 'json'),
  )
  check(
    'neither prompt asks it to open anything it has no tool for',
    !/\bRead\b|\bopen the file\b/.test(FAST_REVIEW_SYSTEM + FAST_ASK_SYSTEM),
  )

  for (const [name, pass, detail] of checks) {
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
  }
  const failed = checks.filter(([, pass]) => !pass)
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
  assert.equal(failed.length, 0)
} finally {
  rmSync(root, { recursive: true, force: true })
}
