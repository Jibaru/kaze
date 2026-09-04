/**
 * Parsing the review's closing JSON block.
 *
 * The model is asked to end its reply with one fenced block. It usually does.
 * Everything here assumes it sometimes will not, and degrades to markdown-only
 * rather than failing the review — a review you can read but not file is still
 * worth having.
 */

export type Severity = 'high' | 'medium' | 'low'
export type Verdict = 'solid' | 'needs_work' | 'does_not_meet_brief'

export interface Finding {
  id: string
  severity: Severity
  pillar: string
  bp_id: string | null
  nodes: string[]
  claim: string
  fix: string
}

export interface ReviewPayload {
  verdict: Verdict
  spoken_summary: string
  findings: Finding[]
  resolved: string[]
}

export type ReviewProblem = 'no-block' | 'not-a-payload'

export interface ParsedReview {
  /** The review text with the JSON block stripped — what the panel renders. */
  markdown: string
  payload: ReviewPayload | null
  /**
   * Why parsing failed. A code rather than a sentence: this reaches the panel
   * and has to be shown in the user's language.
   */
  problem: ReviewProblem | null
}

/**
 * Any info string, not just `json`. A fence is whatever the model felt like
 * typing after the backticks, and a payload tagged `JSON` or `json5` was left
 * in the transcript verbatim while this only accepted lowercase `json`.
 */
const FENCED = /```[^\n`]*\n([\s\S]*?)\n?```/g

/**
 * The last `{...}` that starts a line and parses, scanned from the end.
 *
 * This exists because a fenced block is not the only shape a payload arrives
 * in: the closing fence sometimes never comes, and sometimes there is no fence
 * at all. Neither can be matched by looking for a pair of fences, and both put
 * a wall of raw JSON in front of the user. Cheap, because it only runs once the
 * fenced path has already failed.
 */
function lastJsonObject(text: string): { value: unknown; start: number } | null {
  for (let i = text.length - 1; i >= 0; i--) {
    if (text[i] !== '{') continue
    // Only whitespace may precede it on its line. Requiring the newline
    // immediately before missed an indented code block, which is how the model
    // emits the payload when it does not fence it — the one shape that put a
    // wall of JSON in front of the user in the running app.
    const lineStart = text.lastIndexOf('\n', i - 1) + 1
    if (text.slice(lineStart, i).trim() !== '') continue
    const tail = text
      .slice(i)
      .replace(/(?:```|~~~)[^`~]*$/, '')
      .trim()
    const end = tail.lastIndexOf('}')
    if (end === -1) continue
    try {
      return { value: JSON.parse(tail.slice(0, end + 1)), start: i }
    } catch {
      // Not the start of a complete object; keep scanning backwards.
    }
  }
  return null
}

const SEVERITIES: Severity[] = ['high', 'medium', 'low']
const VERDICTS: Verdict[] = ['solid', 'needs_work', 'does_not_meet_brief']

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)

/** Coerce rather than reject: a finding with a wrong severity is still a finding. */
function coerceFinding(raw: unknown, index: number): Finding | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const claim = str(r.claim)
  if (!claim) return null
  const severity = SEVERITIES.includes(r.severity as Severity) ? (r.severity as Severity) : 'medium'
  return {
    id: str(r.id) || `f-unnamed-${index}`,
    severity,
    pillar: str(r.pillar, 'general'),
    bp_id: typeof r.bp_id === 'string' && r.bp_id.trim() !== '' ? r.bp_id : null,
    nodes: Array.isArray(r.nodes) ? r.nodes.filter((n): n is string => typeof n === 'string') : [],
    claim,
    fix: str(r.fix),
  }
}

function coercePayload(raw: unknown): ReviewPayload | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!Array.isArray(r.findings)) return null
  const findings = r.findings.map(coerceFinding).filter((f): f is Finding => f !== null)
  return {
    verdict: VERDICTS.includes(r.verdict as Verdict) ? (r.verdict as Verdict) : 'needs_work',
    spoken_summary: str(r.spoken_summary),
    findings,
    resolved: Array.isArray(r.resolved) ? r.resolved.filter((x): x is string => typeof x === 'string') : [],
  }
}

/**
 * Takes the *last* parseable fenced block that looks like a review payload.
 * Last, because the skill is told to close with it and a review may well quote
 * an example block earlier in its prose.
 */
export function parseReview(text: string): ParsedReview {
  const blocks: Array<{ body: string; start: number; end: number }> = []
  for (const match of text.matchAll(FENCED)) {
    blocks.push({ body: match[1]!, start: match.index!, end: match.index! + match[0].length })
  }

  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i]!
    let parsed: unknown
    try {
      parsed = JSON.parse(block.body)
    } catch {
      continue
    }
    const payload = coercePayload(parsed)
    if (!payload) continue
    const markdown = (text.slice(0, block.start) + text.slice(block.end)).trim()
    return { markdown, payload, problem: null }
  }

  // Fenced parsing is done. Anything left is a payload the fences did not
  // contain — an unterminated block, or one emitted with no fence at all.
  const bare = lastJsonObject(text)
  if (bare) {
    const payload = coercePayload(bare.value)
    if (payload) {
      const markdown = text
        .slice(0, bare.start)
        .replace(/(?:```|~~~)[^\n`~]*\s*$/, '')
        .trim()
      return { markdown, payload, problem: null }
    }
  }

  const sawJson = blocks.length > 0
  return {
    markdown: text.trim(),
    payload: null,
    problem: sawJson ? 'not-a-payload' : 'no-block',
  }
}

/** One corrective turn is worth trying before giving up on the block. */
export const REPAIR_PROMPT =
  'Your last reply did not end with a valid findings block. Re-emit ONLY the fenced ```json block described in the kaze-review skill, for the review you just gave. No other text.'
