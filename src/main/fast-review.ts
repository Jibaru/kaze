import { serialize, type DiagramDiff } from '../shared/adl'
import { openEntries, type Ledger } from '../shared/ledger'
import { REPLY_LANGUAGE, type Locale } from '../shared/i18n'
import type { Diagram } from '../shared/types'
import type { ScenarioSource } from './scenarios'

/**
 * Fast mode: a review that loads nothing.
 *
 * The ordinary path is a conversation with a working directory. It resumes the
 * attempt's session, loads the project settings, connects the AWS Knowledge MCP
 * server, opens the `kaze-review` skill and then reads three files before it
 * writes a word. Every one of those is a separate round trip to the model, and
 * they happen while you sit looking at your diagram.
 *
 * None of it is wasted — it is why the slow path can cite a best practice id and
 * remember what you said four revisions ago. But most of the time you have just
 * moved a box and want to know whether it helped, and the answer to that is
 * already sitting in three files the app itself wrote.
 *
 * So fast mode inlines them. The scenario (rubric included), the serialized
 * design, and the findings still open from earlier revisions all go into the
 * prompt, and the reviewer is given no tools at all. The first thing the model
 * writes is the review.
 *
 * What it gives up, stated plainly so nobody has to discover it: no AWS
 * Knowledge lookups, so a `bp_id` is only as good as the model's memory; no
 * `references/`; a smaller model; no extended thinking; and three findings
 * instead of eight. It is the second opinion between revisions, not the one you
 * grade yourself on.
 */

/**
 * Which model a fast turn runs on. Named rather than inherited: "fast" that
 * silently follows whatever the user's CLI defaults to is not a mode, it is a
 * coincidence.
 */
export const FAST_MODEL = 'sonnet'

const CONTRACT = `Close with exactly one fenced json block, and nothing after it:

\`\`\`json
{
  "verdict": "solid | needs_work | does_not_meet_brief",
  "spoken_summary": "About 60 words of plain prose written to be heard, not read: no ids, no markdown, no lists. The verdict, the one thing to fix and why it matters at this scale, then what is genuinely good.",
  "findings": [
    {
      "id": "f-stable-kebab-id",
      "severity": "high | medium | low",
      "pillar": "reliability | security | performance | cost | operations",
      "bp_id": "REL13-BP02, or null if you are not certain of the id",
      "nodes": ["n5"],
      "claim": "One sentence: what is wrong and what it causes.",
      "fix": "One sentence: the concrete change."
    }
  ],
  "resolved": ["ids-from-the-open-findings-list-that-this-design-fixes"]
}
\`\`\``

/**
 * Replaces the Claude Code system prompt outright rather than appending to it.
 * The preset is written for an agent with a filesystem and twenty tools; this
 * turn has neither, and every token of that preamble is latency before the
 * first word of the review.
 */
export const FAST_REVIEW_SYSTEM = `You review practice AWS architecture diagrams for someone training for a system design interview. You have no tools and nothing to look up: everything you need is in the message.

The design arrives as kaze-adl. Its \`gaps:\` section is computed by the app, not by you — each line is a question the design leaves open. Treat it as a list of suspects, not a list of findings: raise one only when it actually matters for this brief.

Write at most four lines of prose first: does this design meet the brief, and where does it break first. Then at most three findings, most severe first, one line each. Ruthlessly prefer what would end an interview badly over what is merely true. Judge against the brief and its rubric, never against generic best practice, and never quote the rubric back — it is hidden from them.

You are not auditing a production workload. Feedback that reads like a compliance report teaches nothing.

Where findings from earlier revisions are listed, reuse those exact ids when you raise the same problem again, and name under \`resolved\` only the ones this design genuinely fixes. A false claim there tells someone they fixed something they did not.

${CONTRACT}`

/** Questions get the same context and none of the machinery. */
export const FAST_ASK_SYSTEM = `You are answering a question about a practice AWS architecture diagram, for someone training for a system design interview. You have no tools and nothing to look up: everything you need is in the message.

The design arrives as kaze-adl. Its \`gaps:\` section is computed by the app — questions the design leaves open, not findings.

Answer the question that was asked, in at most six lines. Be concrete about this design at this scale. Do not review what you were not asked about, do not list findings, and do not emit a json block.`

export interface FastContext {
  scenario: ScenarioSource | null
  diagram: Diagram
  /** Absent on a question: only a review earns a revision number. */
  revision: number | undefined
  diff: DiagramDiff | null
  ledger: Ledger | null
  locale: Locale
}

/** The whole review turn, in one message. */
export function fastReviewPrompt(ctx: FastContext): string {
  return [scenarioBlock(ctx), designBlock(ctx), ledgerBlock(ctx), REPLY_LANGUAGE[ctx.locale]].join(
    '\n\n',
  )
}

/**
 * A question carries the same context as a review. It could carry less on a
 * turn that continues a fast conversation — but then a question asked before
 * any review would be answered against a design the model has never seen, and
 * the design has usually changed since the last turn anyway. Prompt caching
 * makes the repetition close to free; being wrong about which boxes are on the
 * canvas is not.
 */
export function fastAskPrompt(ctx: FastContext, question: string): string {
  return [
    scenarioBlock(ctx),
    designBlock(ctx),
    ledgerBlock(ctx),
    `question: ${question}`,
    REPLY_LANGUAGE[ctx.locale],
  ].join('\n\n')
}

const scenarioBlock = ({ scenario, diagram }: FastContext): string =>
  scenario
    ? `# Scenario: ${scenario.title}\n\n${scenario.text}`
    : `# Scenario\n\nNone on file for \`${diagram.scenarioId}\`. Judge the design on its own terms and say so.`

const designBlock = ({ diagram, revision, diff }: FastContext): string =>
  `# Design (kaze-adl)\n\n\`\`\`yaml\n${serialize(diagram, { revision, diff })}\`\`\``

/**
 * The ledger is what the slow path reads off disk to stay consistent between
 * revisions, so fast mode hands over the same thing. Only what is still open:
 * a resolved finding re-listed invites it to be raised again.
 */
function ledgerBlock({ ledger }: FastContext): string {
  const open = ledger ? openEntries(ledger) : []
  if (open.length === 0) {
    return '# Findings still open from earlier revisions\n\nNone — this is the first look, or everything raised so far has been fixed.'
  }
  const lines = open.map(
    (e) =>
      `- ${e.id} · ${e.severity} · ${e.pillar} · ${e.nodes.length ? e.nodes.join(', ') : 'whole design'} · ${e.status} — ${e.claim}`,
  )
  return `# Findings still open from earlier revisions\n\n${lines.join('\n')}`
}
