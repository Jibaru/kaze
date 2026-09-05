import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Locale } from '../shared/i18n'
import type { Concept, Scenario } from '../shared/types'

const RUBRIC = /<!--\s*RUBRIC:START[\s\S]*?RUBRIC:END\s*-->/g
/** Localized briefs live in the same file as the rubric, so they cannot drift
 *  apart from the requirements the review is judged against. */
const BRIEF_BLOCK = /<!--\s*BRIEF:([a-z]{2})\s*-->([\s\S]*?)<!--\s*\/BRIEF:\1\s*-->/g

/**
 * Reads the scenario bank.
 *
 * The rubric is stripped here, in the main process, before the brief ever
 * reaches the renderer. If you can read the answer key you are not practising —
 * and a rubric that merely isn't rendered is one devtools inspection away from
 * being read.
 */
export async function listScenarios(root: string, locale: Locale = 'en'): Promise<Scenario[]> {
  let files: string[]
  try {
    files = (await readdir(join(root, 'scenarios'))).filter((f) => f.endsWith('.md'))
  } catch {
    return []
  }

  const scenarios = await Promise.all(
    files.map(async (file) => {
      // Normalized on read: scenario files are edited by hand, and a file saved
      // by a Windows editor arrives with CRLF, which quietly stops the
      // frontmatter and brief markers from matching.
      const raw = (await readFile(join(root, 'scenarios', file), 'utf-8')).replace(
        /\r\n/g,
        '\n',
      )
      const id = file.replace(/\.md$/, '')
      const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(raw)
      const meta = frontmatter ? parseFrontmatter(frontmatter[1]!) : {}
      const withoutRubric = (frontmatter ? raw.slice(frontmatter[0].length) : raw).replace(RUBRIC, '')

      // A localized brief replaces the default one; every other language's
      // block is removed so it never leaks into the panel.
      const localized = [...withoutRubric.matchAll(BRIEF_BLOCK)].find((m) => m[1] === locale)
      const body = (localized ? localized[2]! : withoutRubric.replace(BRIEF_BLOCK, '')).trim()

      return {
        id: meta.id ?? id,
        title: meta[`title_${locale}`] ?? meta.title ?? id,
        difficulty: Number(meta.difficulty ?? 1),
        brief: body,
      }
    }),
  )

  return scenarios.sort((a, b) => a.difficulty - b.difficulty || a.title.localeCompare(b.title))
}

function parseFrontmatter(block: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of block.split('\n')) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line.trim())
    if (match) out[match[1]!] = match[2]!.replace(/^["']|["']$/g, '')
  }
  return out
}

/** A scenario as the reviewer should read it, rubric and all. */
export interface ScenarioSource {
  id: string
  title: string
  difficulty: number
  /** Canonical brief plus rubric, with every localized copy removed. */
  text: string
}

/**
 * The one place the rubric is deliberately handed out.
 *
 * It never crosses to the renderer — this is read in the main process and goes
 * straight into a prompt, so that fast mode does not have to spend a round trip
 * asking the model to open a file the app already has.
 *
 * The localized briefs are stripped rather than substituted: they say the same
 * thing as the canonical one, and paying prompt tokens to state the
 * requirements twice is exactly what fast mode exists to stop. The reviewer
 * reads English and answers in the interface language.
 */
export async function readScenarioSource(
  root: string,
  id: string,
): Promise<ScenarioSource | null> {
  let raw: string
  try {
    raw = (await readFile(join(root, 'scenarios', `${id}.md`), 'utf-8')).replace(/\r\n/g, '\n')
  } catch {
    return null
  }

  const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(raw)
  const meta = frontmatter ? parseFrontmatter(frontmatter[1]!) : {}
  const text = (frontmatter ? raw.slice(frontmatter[0].length) : raw)
    .replace(BRIEF_BLOCK, '')
    // The markers are scaffolding for the stripping above; the rubric itself
    // stays, and reads better without an HTML comment wrapped round it.
    .replace(/<!--\s*RUBRIC:(?:START|END)[^>]*-->/g, '')
    .trim()

  return {
    id: meta.id ?? id,
    title: meta.title ?? id,
    difficulty: Number(meta.difficulty ?? 1),
    text,
  }
}

const CHECKS = /<!--\s*CHECKS:START[\s\S]*?CHECKS:END\s*-->/g

/**
 * The concept bank.
 *
 * Concepts are to lessons what scenarios are to reviews, down to the hidden
 * half: a scenario hides its rubric so you cannot design to it, and a concept
 * hides its checks so you cannot rehearse the answers. Both are stripped here,
 * in the main process, before anything reaches the renderer.
 */
export async function listConcepts(root: string, locale: Locale = 'en'): Promise<Concept[]> {
  let files: string[]
  try {
    files = (await readdir(join(root, 'concepts'))).filter((f) => f.endsWith('.md'))
  } catch {
    return []
  }

  const concepts = await Promise.all(
    files.map(async (file) => {
      const raw = (await readFile(join(root, 'concepts', file), 'utf-8')).replace(/\r\n/g, '\n')
      const id = file.replace(/\.md$/, '')
      const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(raw)
      const meta = frontmatter ? parseFrontmatter(frontmatter[1]!) : {}
      const body = (frontmatter ? raw.slice(frontmatter[0].length) : raw).replace(CHECKS, '').trim()
      return {
        id: meta.id ?? id,
        title: meta[`title_${locale}`] ?? meta.title ?? id,
        service: meta.service ?? '',
        difficulty: Number(meta.difficulty ?? 1),
        steps: Number(meta.steps ?? 5),
        summary: body,
      }
    }),
  )

  return concepts.sort((a, b) => a.difficulty - b.difficulty || a.title.localeCompare(b.title))
}

/** The whole concept, checks included. Main-process only, like the rubric. */
export async function readConceptSource(
  root: string,
  id: string,
): Promise<{ title: string; service: string; steps: number; text: string } | null> {
  let raw: string
  try {
    raw = (await readFile(join(root, 'concepts', `${id}.md`), 'utf-8')).replace(/\r\n/g, '\n')
  } catch {
    return null
  }
  const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(raw)
  const meta = frontmatter ? parseFrontmatter(frontmatter[1]!) : {}
  const text = (frontmatter ? raw.slice(frontmatter[0].length) : raw)
    .replace(/<!--\s*CHECKS:(?:START|END)[^>]*-->/g, '')
    .trim()
  return {
    title: meta.title ?? id,
    service: meta.service ?? '',
    steps: Number(meta.steps ?? 5),
    text,
  }
}
