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
  canvasInventory,
  spokenHalf,
  spokenHalfComplete,
} from '../src/main/conversation.ts'
import { applyPatch, parsePatch } from '../src/shared/patch.ts'
import { clampSpeed, SPEECH_RATES } from '../src/shared/openai-audio.ts'
import { LESSON_SYSTEM, lessonOpening, lessonTurn } from '../src/main/lesson.ts'
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
  // The app assigns node ids and the model has no other way to learn them.
  // Left to guess, it guessed — and a wrong id is an operation that quietly
  // does nothing, which it answers by drawing the whole design again.
  const turn = conversationTurn('añade una caché', [], started)
  check('a turn carries what was said', turn.includes('añade una caché'))
  check('and the real ids of everything on the canvas',
    turn.includes('n1') && turn.includes('n2') && turn.includes('ALB'))
  check('and the connections between them', turn.includes('n1 -> n2'))
  check('an empty canvas says so rather than listing nothing',
    conversationTurn('empecemos', [], empty).includes('Nothing yet'))
  check('a refusal is passed on, or it keeps talking about a box that is not there',
    conversationTurn('y ahora?', ['unknown service: Memcached'], started).includes('unknown service: Memcached'))
  check('and the refusal is marked as not drawn',
    conversationTurn('y ahora?', ['x'], started).includes('not on the canvas'))

  const inventory = canvasInventory({
    ...started,
    groups: [{ id: 'az-a', kind: 'az', label: 'eu-west-1a', x: 0, y: 0, width: 400, height: 300 }],
    nodes: started.nodes.map((n) => (n.id === 'n2' ? { ...n, parentId: 'az-a' } : n)),
  })
  check('boundaries are listed too: move_node needs their ids', inventory.includes('az-a'))
  check('and which box is inside which', /n2.*in az-a/.test(inventory), inventory)
  check('the inventory carries labels, so it can talk about them by name',
    inventory.includes('"urls"'))
  check('but not the properties or the gaps: this is for wiring, not reviewing',
    !inventory.includes('gaps:') && !inventory.includes('multi_az'))
  check('it tells the model the ids are not its to invent',
    CONVERSATION_SYSTEM.includes('never invent one') && CONVERSATION_SYSTEM.includes('never re-add'))
  check('and that an alias is a word, not an id',
    CONVERSATION_SYSTEM.includes('never something id-shaped'))

  // ── the same thing twice ───────────────────────────────────────────────
  const again = [{ op: 'add_node', service: 'ALB', label: 'edge', as: 'lb' },
                 { op: 'add_edge', from: 'lb', to: 'n2', protocol: 'SQL' }]
  const dup = applyPatch(started, parsePatch(again), { refuseDuplicates: true })
  check('a node that is already there is refused rather than drawn twice',
    dup.diagram.nodes.length === 2, String(dup.diagram.nodes.length))
  check('and the refusal names the one that is there, which is how the id gets learned',
    dup.rejected[0]?.reason.includes('n1') === true, dup.rejected[0]?.reason)
  check('the rest of the reply still wires up, to the node that exists',
    dup.diagram.edges.some((e) => e.from === 'n1' && e.to === 'n2' && e.protocol === 'SQL'),
    JSON.stringify(dup.diagram.edges))
  check('a genuinely different label is not a duplicate',
    applyPatch(started, parsePatch([{ op: 'add_node', service: 'ALB', label: 'edge interno' }]),
      { refuseDuplicates: true }).diagram.nodes.length === 3)
  check('and an autofix is left alone: a second Lambda beside the first may be the point',
    applyPatch(started, parsePatch([{ op: 'add_node', service: 'ALB', label: 'edge' }])).diagram.nodes.length === 3)

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

  // ── the lesson ─────────────────────────────────────────────────────────
  const concept = { title: 'Lambda', service: 'Lambda', steps: 6, text: 'CONCEPT-BODY' }
  const open = lessonOpening({ concept, conceptId: 'lambda', diagram: empty, locale: 'es' })
  check('the opening carries the concept', open.includes('CONCEPT-BODY'))
  check('and the step count, which the app owns', open.includes('Step 1 of 6'))
  check('and draws nothing: it asks what they already know first',
    open.includes('Draw nothing yet'))
  check('a missing concept is admitted rather than invented',
    lessonOpening({ concept: null, conceptId: 'nope', diagram: empty, locale: 'es' })
      .includes('nothing on file'))
  check('their existing work is not silently cleared',
    lessonOpening({ concept, conceptId: 'lambda', diagram: started, locale: 'es' })
      .includes('Do not clear it without saying so'))

  const mid = lessonTurn('no sé', [], started, 3, 6)
  check('a turn says where the lesson is', mid.includes('Step 3 of 6'))
  check('and carries the canvas, so the ids are real', mid.includes('n1'))
  check('and refuses to move on for an answer that is only words',
    mid.includes('the mechanism, not the words'))
  const last = lessonTurn('ya', [], started, 6, 6)
  check('the last step is told to close rather than open another idea',
    last.includes('last step') && last.includes('lesson is done'))

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

  // ── drawing what happens, not only what exists ────────────────────────
  // A sequence is the one thing a box diagram cannot say, and the lesson
  // reaches for it the first time it explains a runtime.
  const lifelines: Diagram = {
    ...empty,
    nodes: [
      { id: 'n1', serviceId: 'Lifeline', label: 'cliente', props: {}, x: 0, y: 0 },
      { id: 'n2', serviceId: 'Lifeline', label: 'entorno', props: {}, x: 300, y: 0 },
      { id: 'n3', serviceId: 'Lambda', label: 'fn', props: {}, x: 600, y: 0 },
    ],
  }
  const messages = applyPatch(
    lifelines,
    parsePatch([
      { op: 'add_edge', from: 'n1', to: 'n2', step: 1, label: 'invoca' },
      { op: 'add_edge', from: 'n2', to: 'n2', step: 2, label: 'init del runtime' },
      { op: 'add_edge', from: 'n1', to: 'n2', step: 3, label: 'segunda llamada' },
    ]),
  )
  check('an ordered message carries its step', messages.diagram.edges[0]?.step === 1)
  check('a lifeline may message itself: that is a runtime calling itself',
    messages.diagram.edges.some((e) => e.from === 'n2' && e.to === 'n2' && e.step === 2),
    messages.rejected.map((r) => r.reason).join('; '))
  check('two messages between the same pair are not duplicates: they differ by step',
    messages.diagram.edges.filter((e) => e.from === 'n1' && e.to === 'n2').length === 2)
  check('and they get distinct ids, or one would replace the other',
    new Set(messages.diagram.edges.map((e) => e.id)).size === messages.diagram.edges.length)
  check('a service still may not connect to itself',
    applyPatch(lifelines, parsePatch([{ op: 'add_edge', from: 'n3', to: 'n3', step: 1 }])).rejected.length === 1)
  check('nor may a lifeline, without a step to place the message on',
    applyPatch(lifelines, parsePatch([{ op: 'add_edge', from: 'n2', to: 'n2' }])).rejected.length === 1)

  // Lifelines are columns four hundred pixels tall. Placed on the grid the
  // boxes use, the next row lands inside the one above it.
  const drawn = applyPatch(
    empty,
    parsePatch([
      { op: 'add_node', service: 'Lifeline', label: 'cliente' },
      { op: 'add_node', service: 'Lifeline', label: 'servicio' },
      { op: 'add_node', service: 'Lifeline', label: 'entorno' },
    ]),
  )
  const columns = drawn.diagram.nodes
  check('lifelines are placed in a row, not on the grid the boxes use',
    columns.every((n) => n.y === columns[0]!.y), JSON.stringify(columns.map((n) => `${n.x},${n.y}`)))
  check('and spread far enough apart for a message label to fit between them',
    columns[1]!.x - columns[0]!.x >= 300)
  const mixed = applyPatch(drawn.diagram, parsePatch([{ op: 'add_node', service: 'Lambda', label: 'fn' }]))
  const box = mixed.diagram.nodes.find((n) => n.serviceId === 'Lambda')!
  check('a box is not dropped inside the column a lifeline occupies',
    !columns.some((c) => Math.abs(c.x - box.x) < 280 && Math.abs(c.y - box.y) < 460),
    `${box.x},${box.y}`)

  check('the lesson is told to draw time with lifelines and steps',
    LESSON_SYSTEM.includes('lifelines and numbered steps'))
  check('and not to accept the words back',
    LESSON_SYSTEM.includes('Do not accept the words back'))
  check('and to ask, then wait', LESSON_SYSTEM.includes('Ask, then wait'))
  check('every operation the lesson is shown is one the app accepts',
    [...LESSON_SYSTEM.matchAll(/"op":\s*"([a-z_]+)"/g)].every(
      (m) => parsePatch([{ op: m[1]! }], { allowRemoveNode: true }).length === 1,
    ))

  // ── how fast it reads ──────────────────────────────────────────────────
  // Asked of the synthesizer rather than done to the audio afterwards: Web
  // Audio has no time-stretching, so speeding a buffer up shifts the pitch.
  check('every offered speed is one the API accepts',
    SPEECH_RATES.every((r) => clampSpeed(r) === r), SPEECH_RATES.join(', '))
  check('the offered speeds start at normal and only go up',
    SPEECH_RATES[0] === 1 && SPEECH_RATES.every((r, i, a) => i === 0 || r > a[i - 1]!))
  check('a speed outside the API range is pulled back rather than sent',
    clampSpeed(9) === 4 && clampSpeed(0) === 0.25)
  check('anything that is not a finite speed reads at normal speed',
    clampSpeed(Number.NaN) === 1 && clampSpeed(Number.POSITIVE_INFINITY) === 1,
    `${clampSpeed(Number.NaN)}, ${clampSpeed(Number.POSITIVE_INFINITY)}`)

  for (const [name, pass, detail] of checks) {
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
  }
  const failed = checks.filter(([, pass]) => !pass)
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
  assert.equal(failed.length, 0)
} finally {
  rmSync(root, { recursive: true, force: true })
}
