/**
 * Conversation mode has two halves that have to stay honest with each other:
 * a reply split into something to say and something to draw, and an operation
 * set that is wider here than anywhere else in the app.
 *
 * Run: node scripts/check.mjs scripts/check-conversation.mts
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readScenarioSource } from '../src/main/scenarios.ts'
import {
  CONVERSATION_SYSTEM,
  conversationOpening,
  conversationTurn,
  spokenHalf,
  spokenHalfComplete,
} from '../src/main/conversation.ts'
import { applyPatch, parsePatch } from '../src/shared/patch.ts'
import type { Diagram } from '../src/shared/types.ts'

const checks: Array<[string, boolean, string?]> = []
const check = (name: string, pass: boolean, detail = '') => checks.push([name, pass, detail])

const root = mkdtempSync(join(tmpdir(), 'kaze-chat-'))
mkdirSync(join(root, 'scenarios'), { recursive: true })
writeFileSync(
  join(root, 'scenarios', 'shortener.md'),
  '---\nid: shortener\ntitle: URL shortener\n---\n\n## Brief\n\nCANONICAL-BRIEF\n',
  'utf-8',
)

const empty: Diagram = { version: 1, scenarioId: 'shortener', groups: [], nodes: [], edges: [] }
const started: Diagram = {
  ...empty,
  nodes: [
    { id: 'n1', serviceId: 'ALB', label: 'edge', props: {}, x: 0, y: 0 },
    { id: 'n2', serviceId: 'RDS', label: 'urls', props: {}, x: 260, y: 0 },
  ],
  edges: [{ id: 'e1', from: 'n1', to: 'n2', protocol: 'SQL' }],
}

const FENCE = '`'.repeat(3)
const reply = (prose: string, ops: string) => `${prose}\n\n${FENCE}json\n${ops}\n${FENCE}`

try {
  const scenario = await readScenarioSource(root, 'shortener')

  // ── the opening ────────────────────────────────────────────────────────
  const blank = conversationOpening({ scenario, diagram: empty, locale: 'es' })
  check('the opening carries the brief, so nothing has to open a file', blank.includes('CANONICAL-BRIEF'))
  check('an empty canvas is described as empty', blank.includes('blank sheet'))
  check('it is told to frame the case rather than draw it', blank.includes('Draw nothing yet'))
  check('and to answer in the interface language', blank.includes('español'))

  const resumed = conversationOpening({ scenario, diagram: started, locale: 'es' })
  check('an existing design is sent instead of the blank-sheet line',
    resumed.includes('n1') && resumed.includes('ALB') && !resumed.includes('blank sheet'))
  check('the opening still draws nothing when there is already a design',
    resumed.includes('Draw nothing yet'))

  const noBrief = conversationOpening({ scenario: null, diagram: empty, locale: 'en' })
  check('a missing brief is admitted rather than invented', noBrief.includes('no brief on file'))

  // ── a turn ─────────────────────────────────────────────────────────────
  check('an ordinary turn is just what was said: the model already holds the design',
    conversationTurn('añade una caché', []) === 'añade una caché')
  check('a refusal is passed on, or it keeps talking about a box that is not there',
    conversationTurn('y ahora?', ['unknown service: Memcached']).includes('unknown service: Memcached'))
  check('and the refusal is marked as not drawn',
    conversationTurn('y ahora?', ['x']).includes('not on the canvas'))

  // ── splitting the reply ────────────────────────────────────────────────
  const full = reply('Añadí un balanceador delante. ¿Dónde guardas los códigos?', '[]')
  check('the spoken half stops at the operations',
    spokenHalf(full) === 'Añadí un balanceador delante. ¿Dónde guardas los códigos?', spokenHalf(full))
  check('a reply with no operations is all speech',
    spokenHalf('Solo una pregunta: ¿cuántas lecturas?') === 'Solo una pregunta: ¿cuántas lecturas?')
  check('an inline backtick does not cut the sentence in half',
    spokenHalf('Un `id` corto y ya está.') === 'Un `id` corto y ya está.')

  // Speech starts the moment the fence opens, while the json is still arriving.
  check('speech can start as soon as the fence opens', spokenHalfComplete(full))
  check('a half-written sentence is not sent to the synthesizer',
    !spokenHalfComplete('Añadí un balanceador delante. ¿Dónde'))
  check('a reply that opens with the fence has no spoken half to start early on',
    !spokenHalfComplete(`${FENCE}json\n[]`))

  // ── the operation set ──────────────────────────────────────────────────
  const removal = [{ op: 'remove_node', node: 'n1' }]
  check('remove_node is refused everywhere by default', parsePatch(removal).length === 0)
  check('and accepted only where the caller asks for it',
    parsePatch(removal, { allowRemoveNode: true }).length === 1)

  const gone = applyPatch(started, parsePatch(removal, { allowRemoveNode: true }))
  check('removing a node removes it', gone.diagram.nodes.every((n) => n.id !== 'n1'))
  check('its connections go with it, or every later gap is about the wreckage',
    gone.diagram.edges.length === 0, JSON.stringify(gone.diagram.edges))
  check('and it says what it did', gone.applied[0]?.startsWith('- n1') === true, gone.applied.join(', '))
  check('removing a node that is not there is refused, not guessed at',
    applyPatch(started, parsePatch([{ op: 'remove_node', node: 'n99' }], { allowRemoveNode: true }))
      .rejected.length === 1)

  // ── placement ──────────────────────────────────────────────────────────
  // Conversation mode adds boxes several a minute to a canvas nobody has
  // arranged; a fixed offset from the anchor used to pile them up.
  const many = applyPatch(
    empty,
    parsePatch([
      { op: 'add_node', service: 'ALB' },
      { op: 'add_node', service: 'Lambda' },
      { op: 'add_node', service: 'DynamoDB' },
      { op: 'add_node', service: 'S3' },
      { op: 'add_node', service: 'SQS' },
      { op: 'add_node', service: 'ElastiCache' },
    ]),
  )
  check('six boxes in a row all land', many.diagram.nodes.length === 6, many.rejected.map((r) => r.reason).join('; '))
  const spots = new Set(many.diagram.nodes.map((n) => `${n.x},${n.y}`))
  check('and no two of them land on the same spot', spots.size === 6, [...spots].join(' '))

  const near = applyPatch(started, parsePatch([{ op: 'add_node', service: 'ElastiCache', near: 'n2' }]))
  const added = near.diagram.nodes.find((n) => n.serviceId === 'ElastiCache')!
  check('a node placed near another does not land on top of it',
    !near.diagram.nodes.some((n) => n.id !== added.id && n.x === added.x && n.y === added.y))

  // ── the contract ───────────────────────────────────────────────────────
  check('the system prompt asks for speech first and operations after',
    CONVERSATION_SYSTEM.indexOf('read aloud') < CONVERSATION_SYSTEM.indexOf('fenced json array'))
  check('it caps the spoken half, which is the biggest lever on both waits',
    CONVERSATION_SYSTEM.includes('25 words'))
  check('it is told not to draw the whole design at once',
    CONVERSATION_SYSTEM.includes('Draw only what was just agreed'))
  check('it is told the app places nodes', CONVERSATION_SYSTEM.includes('The app places nodes'))
  check('it does not talk about ids or json out loud',
    CONVERSATION_SYSTEM.includes('Never mention operations, json, ids'))
  check('every operation it is shown is one the app actually accepts',
    [...CONVERSATION_SYSTEM.matchAll(/"op":\s*"([a-z_]+)"/g)].every(
      (m) => parsePatch([{ op: m[1]! }], { allowRemoveNode: true }).length === 1,
    ))

  for (const [name, pass, detail] of checks) {
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
  }
  const failed = checks.filter(([, pass]) => !pass)
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
  assert.equal(failed.length, 0)
} finally {
  rmSync(root, { recursive: true, force: true })
}
