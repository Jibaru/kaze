import { serialize } from '../shared/adl'
import { REPLY_LANGUAGE, type Locale } from '../shared/i18n'
import type { Diagram } from '../shared/types'
import { canvasInventory } from './conversation'

/**
 * Study mode: a lesson that draws.
 *
 * The rest of the app teaches by critique — you draw, it finds what is missing.
 * That only works on a topic you already half know. Studying Lambda is the
 * other direction: you cannot draw what you have not understood yet, so here
 * the lesson leads.
 *
 * It is built on the same machinery as conversation mode — one live process,
 * speech streamed as it is generated, operations the app validates and applies
 * — with three differences that make it a lesson rather than a chat:
 *
 *   - **A syllabus.** The concept file lists what must be understood by the
 *     end. The model works through it; the app owns the list and the count, so
 *     "paso 3 / 6" is a fact rather than the model's impression of one.
 *   - **Hidden checks.** The same discipline as a scenario's rubric: the
 *     questions and the common wrong answers are stripped before anything
 *     reaches the renderer, because rehearsing the answers is not learning.
 *   - **It asks, and it does not accept the words back.** A right-sounding
 *     answer that repeats the phrasing is the failure mode of every spoken
 *     tutor, so the prompt says so and says what to do about it.
 */

const OPS = `  { "op": "add_node", "service": "Lifeline", "label": "Entorno de ejecución", "as": "env" }
  { "op": "add_node", "service": "Note", "label": "Aquí se descarga el paquete y arranca el runtime: 100-800 ms", "near": "env" }
  { "op": "add_edge", "from": "client", "to": "env", "step": 2, "label": "invoca handler" }
  { "op": "add_node", "service": "Lambda", "label": "resolver", "near": "n2", "as": "fn" }
  { "op": "set_props", "node": "n5", "props": { "concurrency": "1000" } }
  { "op": "add_boundary", "kind": "lane", "label": "arranque en frío", "as": "cold" }
  { "op": "move_node", "node": "n9", "into": "cold" }
  { "op": "remove_edge", "from": "n3", "to": "n5" }
  { "op": "remove_node", "node": "n7" }`

export const LESSON_SYSTEM = `You are teaching one AWS concept, out loud, to someone practising for a system design interview. You draw on a shared canvas as you talk. You have no tools — everything you need is in the message.

Every reply has two parts, in this order and nothing else:

1. Two or three sentences to be **read aloud**. No markdown, no lists, no node ids, no service ids spelled as code. Teach one idea, draw it, and end with a question that tests whether they actually followed. Hard limit: 45 words.

2. One fenced json array of operations that changes the canvas. Empty array when nothing should change.

The operations, and their only shapes:

\`\`\`json
[
${OPS}
]
\`\`\`

## How to teach

- **One idea per turn**, in the order the concept file lists them. You are on a numbered step; do not run ahead, and do not summarize the whole concept in the first turn.
- **Draw the idea, do not illustrate the words.** A note that repeats what you just said is noise. Draw the thing that is hard to hold in your head: the participants and the order of a cold start, the fan-out that takes a database down, what is inside a boundary and what is not.
- **For anything about time or order, use lifelines and numbered steps.** \`step\` is the row a message sits on, so a sequence reads top to bottom. That is the only way to draw *when*, and *when* is most of what is hard about a runtime.
- **Ask, then wait.** End every turn with one question from the concept's checks. Do not answer it yourself in the same breath.
- **Do not accept the words back.** An answer that repeats your phrasing is not understanding. If they say the right words with no mechanism behind them, push once — ask what would happen in a specific case — before moving on. When they are wrong, say so plainly, say why, and correct the drawing if it was drawing the wrong thing.
- When they are right, say so in three words and move to the next step. Praise that goes on longer than the answer teaches nothing.

## The canvas

- Ids are assigned by the app and listed every turn. Never invent one, never assume the next one, never re-add something already listed.
- \`as\` is a nickname for something you add in this same reply. It does not survive the turn, so make it a word, never something id-shaped.
- Do not send positions. The app places nodes.
- Clearing the board between ideas is fine and often right: \`remove_node\` exists, and a diagram carrying three ideas at once teaches none of them.

Never mention operations, json, ids or "the canvas" in the spoken half. They can see it.`

export interface LessonContext {
  concept: { title: string; service: string; steps: number; text: string } | null
  conceptId: string
  diagram: Diagram
  locale: Locale
}

/**
 * The opening. It draws nothing and teaches nothing yet: it says what the
 * concept is and asks what they already know, because the answer changes where
 * the lesson starts.
 */
export function lessonOpening({ concept, conceptId, diagram, locale }: LessonContext): string {
  const brief = concept
    ? `# The concept: ${concept.title}\n\n${concept.text}`
    : `# The concept\n\nThere is nothing on file for \`${conceptId}\`. Say so, and offer to teach it from what you know.`

  const canvas =
    diagram.nodes.length > 0
      ? `# Already on the canvas\n\n\`\`\`yaml\n${serialize(diagram)}\`\`\`\n\nThis is their own work. Do not clear it without saying so.`
      : '# Already on the canvas\n\nNothing. A blank board.'

  return [
    brief,
    canvas,
    `# Your first turn\n\nStep 1 of ${concept?.steps ?? 5}. Say in two sentences what this concept is and why it bites people in practice, then ask what they already know about it — their answer decides where you start. Draw nothing yet: send an empty operations array.`,
    REPLY_LANGUAGE[locale],
  ].join('\n\n')
}

/**
 * A turn: what they said, where the lesson is, and what is actually drawn.
 *
 * The step count comes from the concept file rather than from the model. It is
 * the app's to know — the same reason gaps are computed and finding identity is
 * reconciled here rather than trusted.
 */
export function lessonTurn(
  said: string,
  refused: string[],
  diagram: Diagram,
  step: number,
  steps: number,
): string {
  const note = refused.length
    ? `\n\n(The app refused part of your last reply, so it is not on the canvas: ${refused.join('; ')}. Do not refer to anything in it as drawn.)`
    : ''
  const where =
    step >= steps
      ? `# Where you are\n\nThis is the last step (${steps} of ${steps}). If they have understood it, close: name the one thing worth remembering, and say the lesson is done.`
      : `# Where you are\n\nStep ${step} of ${steps}. Move on only when their answer shows the mechanism, not the words.`

  return [canvasInventory(diagram), where, `# They said\n\n${said}${note}`].join('\n\n')
}
