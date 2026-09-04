/**
 * Parsing the review's closing JSON block. Every case here is a way a real
 * model reply has to be survivable: prose around the block, an example block
 * earlier in the text, a trailing sentence after it, a missing field.
 *
 * Run: node scripts/check.mjs scripts/check-findings.mts
 */
import assert from 'node:assert/strict'
import { parseReview } from '../src/shared/findings.ts'

const checks: Array<[string, boolean, string?]> = []
const check = (name: string, pass: boolean, detail = '') => checks.push([name, pass, detail])

const block = (body: string) => '```json\n' + body + '\n```'

const good = block(
  JSON.stringify({
    verdict: 'needs_work',
    spoken_summary: 'The write path is the weak point.',
    findings: [
      {
        id: 'f-db-single-az',
        severity: 'high',
        pillar: 'reliability',
        bp_id: 'REL13-BP02',
        nodes: ['n5'],
        claim: 'The primary datastore is single-AZ.',
        fix: 'Enable Multi-AZ.',
      },
    ],
    resolved: ['f-no-cache'],
  }),
)

const happy = parseReview(`Here is the review.\n\nThe database is the problem.\n\n${good}`)
check('parses a well-formed review', happy.payload !== null)
check('keeps the prose', happy.markdown.includes('The database is the problem.'))
check('strips the block from the prose', !happy.markdown.includes('spoken_summary'))
check('reads the verdict', happy.payload?.verdict === 'needs_work')
check('reads the finding', happy.payload?.findings[0]?.id === 'f-db-single-az')
check('reads resolved ids', happy.payload?.resolved[0] === 'f-no-cache')
check('reports no problem', happy.problem === null)

// A review that quotes the schema before filling it in must not be parsed
// from the example.
const twoBlocks = parseReview(
  `The format is:\n\n${block('{"verdict": "solid", "findings": []}')}\n\nAnd here is the real one:\n\n${good}`,
)
check('takes the LAST payload, not an earlier example', twoBlocks.payload?.findings.length === 1)

// Models trail off after the block more often than they omit it.
const trailing = parseReview(`Review text.\n\n${good}\n\nLet me know if you want me to go deeper.`)
check('survives text after the block', trailing.payload !== null)
check('removes the block but keeps the trailing sentence', trailing.markdown.includes('go deeper'))

// A fenced block with no language tag is still worth trying.
const untagged = parseReview('Review.\n\n```\n' + JSON.stringify({ verdict: 'solid', findings: [] }) + '\n```')
check('accepts an untagged fenced block', untagged.payload !== null)

// Coercion: a finding with a bogus severity is still a finding.
const sloppy = parseReview(
  block(
    JSON.stringify({
      verdict: 'catastrophic',
      findings: [{ id: 'f-x', severity: 'CRITICAL', claim: 'Something is wrong.' }],
    }),
  ),
)
check('coerces an unknown severity rather than dropping the finding', sloppy.payload?.findings[0]?.severity === 'medium')
check('coerces an unknown verdict', sloppy.payload?.verdict === 'needs_work')
check('defaults missing arrays', sloppy.payload?.resolved.length === 0 && sloppy.payload?.findings[0]?.nodes.length === 0)
check('defaults a missing bp_id to null', sloppy.payload?.findings[0]?.bp_id === null)

// A finding with no claim carries no information; drop it rather than render a blank row.
const empty = parseReview(block(JSON.stringify({ verdict: 'solid', findings: [{ id: 'f-y' }] })))
check('drops a finding with no claim', empty.payload?.findings.length === 0)

// Degrade, never throw.
const noBlock = parseReview('I reviewed it and it looks fine to me.')
check('markdown-only review still returns its text', noBlock.markdown.startsWith('I reviewed it'))
check('markdown-only review reports the problem', noBlock.problem?.includes('did not include') === true)

const wrongBlock = parseReview('Review.\n\n```json\n{"not": "a payload"}\n```')
check('a non-payload block is reported as such', wrongBlock.payload === null && wrongBlock.problem !== null)

const brokenJson = parseReview('Review.\n\n```json\n{"verdict": "solid", findings: [}\n```')
check('malformed JSON does not throw', brokenJson.payload === null)

for (const [name, pass, detail] of checks) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}
const failed = checks.filter(([, pass]) => !pass)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
assert.equal(failed.length, 0)
