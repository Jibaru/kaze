import { readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Locale } from '../shared/i18n'

/**
 * Writing a scenario for yourself.
 *
 * The awkward part of a practice brief is the rubric: it is what the review
 * grades against, and it is hidden precisely so you cannot design to it. If you
 * write it yourself you have already read it, and the exercise is worth less.
 *
 * So the app does not offer a rubric field. You give a topic; the model writes
 * the whole file including the rubric, and the app is the only thing that ever
 * reads that section back. Hand-editing stays available for anyone who wants it
 * — the folder is one button away — but it is the escape hatch, not the door.
 */

const LANGUAGE: Record<Locale, string> = {
  es: 'español',
  en: 'English',
}

export const authorPrompt = (topic: string, difficulty: number, locale: Locale): string =>
  `Write one system design practice scenario about: ${topic}

Difficulty ${difficulty} of 3, where 1 is a first interview and 3 is a senior one.
Write the whole file in ${LANGUAGE[locale]}, keeping AWS service names in English.

Reply with ONE fenced markdown block and nothing else. Follow this shape exactly:

\`\`\`markdown
---
id: <kebab-case-slug>
title: <short title>
difficulty: ${difficulty}
---

## <heading for the brief>

<Two or three sentences stating the problem.>

## <heading for functional requirements>

- <three to five bullets>

## <heading for non-functional requirements>

- <three to five bullets, each with a CONCRETE NUMBER: throughput, latency
  target, read/write ratio, retention, durability expectation>

## <heading for constraints>

- <AWS only, budget, region, or whatever genuinely constrains this problem>

<!-- RUBRIC:START -->

## <heading for the rubric>

<Five or six numbered points. Each names one thing a good answer MUST address
and says why it matters AT THE STATED SCALE. These are what the review grades
against, so make them specific to these numbers rather than generic best
practice.>

<Then a short list of common mistakes worth naming when present.>

<!-- RUBRIC:END -->
\`\`\`

The requirements must be answerable with AWS services. The numbers must be
internally consistent: a stated peak has to follow from the stated average.`

/** Only ever a filename, never a path. Model output does not get to traverse. */
export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return slug || 'scenario'
}

export interface AuthoredScenario {
  id: string
  path: string
  markdown: string
}

const FENCED = /```(?:markdown|md)?\s*\n([\s\S]*?)\n?```/g

/**
 * Pull the file out of the reply and refuse anything that would not work as a
 * scenario. A brief with no rubric cannot be graded, and writing it anyway
 * would produce an exercise that silently reviews against nothing.
 */
export function parseAuthored(reply: string): { markdown: string } | { error: string } {
  const blocks = [...reply.matchAll(FENCED)].map((m) => m[1]!)
  const body = blocks.reverse().find((b) => b.includes('RUBRIC:START')) ?? blocks[0]

  if (!body) return { error: 'no-block' }
  if (!/^---\n[\s\S]*?\n---/.test(body.trim())) return { error: 'no-frontmatter' }
  if (!body.includes('RUBRIC:START') || !body.includes('RUBRIC:END')) return { error: 'no-rubric' }

  return { markdown: body.trim() + '\n' }
}

/** Write it under a name that is free, so authoring never clobbers a scenario. */
export async function writeScenario(
  root: string,
  markdown: string,
  fallbackTitle: string,
): Promise<AuthoredScenario> {
  const dir = join(root, 'scenarios')
  const declared = /^id:\s*(.+)$/m.exec(markdown)?.[1]?.trim()
  const base = slugify(declared || fallbackTitle)

  const taken = new Set((await readdir(dir).catch(() => [])).map((f) => f.replace(/\.md$/, '')))
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`

  // The frontmatter id has to match the filename: the review prompt addresses
  // the scenario by `scenarios/<id>.md`.
  const normalized = declared
    ? markdown.replace(/^id:\s*.+$/m, `id: ${id}`)
    : markdown.replace(/^---\n/, `---\nid: ${id}\n`)

  const path = join(dir, `${id}.md`)
  await writeFile(path, normalized, 'utf-8')
  return { id, path, markdown: normalized }
}
