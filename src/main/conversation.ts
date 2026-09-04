import { serialize } from '../shared/adl'
import { REPLY_LANGUAGE, type Locale } from '../shared/i18n'
import type { Diagram } from '../shared/types'
import type { ScenarioSource } from './scenarios'

/**
 * Conversation mode: designing out loud.
 *
 * The rest of the app is a drawing tool that gets reviewed. This is the other
 * way round — you talk, it draws, it asks the next question, you answer. The
 * canvas is the transcript.
 *
 * Everything here is bent towards one number: how long you sit in silence after
 * you stop talking. That chain is transcribe → model → speak, and the model leg
 * is the one this file owns, so:
 *
 *   - It runs on the fast profile. No tools, no skill, no MCP server, no
 *     thinking — see `fast-review.ts`.
 *   - The diagram is sent **once**, when you enter. After that the model is the
 *     only thing changing it, so its own conversation already holds the current
 *     state and re-sending it every turn would pay for the same tokens twice.
 *     The exception is an operation the app refused, which it is told about
 *     because otherwise it would carry on referring to a node that was never
 *     drawn.
 *   - The spoken half comes first and the operations after, so the app can
 *     start synthesizing speech the moment the fence opens instead of waiting
 *     for the json to finish. That is about two seconds of a seven-second turn.
 *   - Replies are capped at 25 words. Measured on a thirty-word reply, the
 *     speech leg alone was four seconds; it is very nearly linear in length,
 *     and a paragraph read aloud is unbearable anyway.
 */

const OPS = `  { "op": "add_node", "service": "ALB", "label": "edge", "near": "n2", "as": "lb" }
  { "op": "add_edge", "from": "lb", "to": "n3", "protocol": "HTTPS" }
  { "op": "set_props", "node": "n5", "props": { "multi_az": true } }
  { "op": "set_protocol", "from": "n2", "to": "n3", "protocol": "gRPC" }
  { "op": "remove_edge", "from": "n3", "to": "n5" }
  { "op": "remove_node", "node": "n7" }
  { "op": "add_boundary", "kind": "az", "label": "eu-west-1b", "as": "azb" }
  { "op": "move_node", "node": "n9", "into": "azb" }`

export const CONVERSATION_SYSTEM = `You are designing an AWS architecture out loud with someone practising for a system design interview. They speak; you draw. You have no tools — everything you need is in the message.

Every reply has two parts, in this order and nothing else:

1. One or two sentences to be **read aloud**. No markdown, no lists, no node ids, no service ids spelled out as code. Say what you just drew and ask the one question that moves the design forward. Hard limit: 25 words. One clause of statement, one short question. This is a conversation, not a briefing — and every extra word is a second longer before they hear it.

2. One fenced json array of operations, which the app applies to the canvas. Empty array when nothing should change.

The operations, and their only shapes:

\`\`\`json
[
${OPS}
]
\`\`\`

Rules that matter:

- \`service\` must be an exact service id from the design you were given, or one of the obvious AWS ones (ALB, NLB, APIGateway, Lambda, ECS, Fargate, EC2, RDS, Aurora, DynamoDB, ElastiCache, S3, SQS, SNS, Kinesis, CloudFront, Route53, WAF, Cognito, EFS, OpenSearch, Redshift, Glue, Athena, EventBridge, StepFunctions, SecretsManager, KMS, CloudWatch, Actor, Custom). The app refuses anything it does not model and will tell you.
- \`as\` names something you add so later operations in the same reply can wire it up. \`from\` initiates, \`to\` receives.
- Do not send positions. The app places nodes.
- **Draw only what was just agreed.** One or two boxes a turn. Running ahead and rendering the whole architecture takes the exercise away from them — the point is that they decide, and you ask the question that makes them decide well.
- Suggest, do not lecture. After you draw, name the one thing that is now missing or now risky, as a question.

Never mention operations, json, ids or "the canvas" in the spoken half. They can see it.`

export interface ConversationContext {
  scenario: ScenarioSource | null
  diagram: Diagram
  locale: Locale
}

/**
 * The opening turn. It draws nothing: the person asked to be told the case at a
 * high level and then to say where to start, and a model that opens by
 * rendering six boxes has answered the exercise for them.
 */
export function conversationOpening({ scenario, diagram, locale }: ConversationContext): string {
  const started = diagram.nodes.length > 0

  const brief = scenario
    ? `# The case: ${scenario.title}\n\n${scenario.text}`
    : `# The case\n\nThere is no brief on file for \`${diagram.scenarioId}\`. Say so, and offer to design something reasonable.`

  const canvas = started
    ? `# What is already on the canvas\n\n\`\`\`yaml\n${serialize(diagram)}\`\`\``
    : '# What is already on the canvas\n\nNothing. This is a blank sheet.'

  const task = started
    ? 'Open by saying in one or two sentences where this design stands and what it is still missing, then ask what to work on. Draw nothing yet: send an empty operations array.'
    : 'Open by framing the case at a high level in two or three sentences — what is being built and what makes it hard at this scale — then ask where they want to start. Draw nothing yet: send an empty operations array.'

  return [brief, canvas, `# Your first turn\n\n${task}`, REPLY_LANGUAGE[locale]].join('\n\n')
}

/**
 * A turn. Just what they said — the model has been holding the diagram since
 * the opening, and re-stating it every turn would be paying twice for the same
 * context and making them wait for it.
 */
export function conversationTurn(said: string, refused: string[]): string {
  const note = refused.length
    ? `\n\n(The app refused part of your last reply, so it is not on the canvas: ${refused.join('; ')}. Work from that, and do not refer to anything in it as drawn.)`
    : ''
  return `${said}${note}`
}

/**
 * A fence at the start of a line. Deliberately not any triple backtick: the
 * spoken half is prose and may well contain one, and cutting the reply there
 * would speak half a sentence.
 */
const FENCE = /(^|\n)[ \t]*```/

/** The half that gets read aloud: everything before the operations. */
export const spokenHalf = (text: string): string => {
  const match = FENCE.exec(text)
  return (match ? text.slice(0, match.index) : text).trim()
}

/**
 * Whether the spoken half is finished, so speech can start while the operations
 * are still streaming. Guarded on length because a reply that opens with the
 * fence has no spoken half and must not be sent to the synthesizer as ''.
 */
export const spokenHalfComplete = (text: string): boolean =>
  FENCE.test(text) && spokenHalf(text).length > 12
