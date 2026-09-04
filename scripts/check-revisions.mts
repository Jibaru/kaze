/**
 * Revision snapshots: the on-disk trail that lets a later review answer
 * "what did I have before I added the queue?" and diff against it.
 *
 * Run: node scripts/check.mjs scripts/check-revisions.mts
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { WorkspaceStore } from '../src/main/workspace-store.ts'
import type { Diagram } from '../src/shared/types.ts'

const checks: Array<[string, boolean, string?]> = []
const check = (name: string, pass: boolean, detail = '') => checks.push([name, pass, detail])

const root = mkdtempSync(join(tmpdir(), 'kaze-ws-'))
const store = new WorkspaceStore(root)

const base: Diagram = {
  version: 1,
  scenarioId: 'url-shortener',
  groups: [{ id: 'az-a', kind: 'az', label: 'eu-west-1a', x: 0, y: 0, width: 400, height: 400 }],
  nodes: [
    { id: 'n1', serviceId: 'ECS', label: 'api', props: { multi_az: true, autoscaling: '2-20' }, x: 0, y: 0, parentId: 'az-a' },
    { id: 'n2', serviceId: 'RDS', label: 'db', props: { engine: 'postgres' }, x: 0, y: 0, parentId: 'az-a' },
  ],
  edges: [{ id: 'e1', from: 'n1', to: 'n2', protocol: 'TCP/5432' }],
}

try {
  const first = await store.snapshotRevision(base)
  check('first snapshot is revision 1', first.revision === 1, String(first.revision))
  check('design.md is written', readFileSync(first.designPath, 'utf-8').includes('service: RDS'))
  check('the revision carries the gaps', readFileSync(first.revisionPath, 'utf-8').includes('no_backup'))

  // Fix the database and add a queue — the shape of a real practice iteration.
  const second: Diagram = {
    ...base,
    nodes: [
      base.nodes[0]!,
      { ...base.nodes[1]!, props: { engine: 'postgres', multi_az: true, backup: 'PITR, 7 days' } },
      { id: 'n3', serviceId: 'SQS', label: 'events', props: { dlq: true }, x: 0, y: 0 },
    ],
    edges: [...base.edges, { id: 'e2', from: 'n1', to: 'n3', protocol: 'HTTPS' }],
  }

  const next = await store.snapshotRevision(second)
  const doc = readFileSync(next.designPath, 'utf-8')

  check('second snapshot is revision 2', next.revision === 2, String(next.revision))
  check('the diff names the added node', next.diff.addedNodes.some((n) => n.startsWith('n3 ')))
  check('the diff names the fixed prop', next.diff.changedProps.includes('n2.multi_az: unset -> true'))
  check('the diff reaches the document the reviewer reads', doc.includes('diff_from_previous:'))
  check('the fixed finding is gone from the new revision', !doc.includes('no_backup'))

  const files = readdirSync(join(root, 'attempts', 'default', 'revisions')).sort()
  check('both revisions are kept, zero-padded and ordered', files.join(' ') ===
    '001-design.md 001-diagram.json 002-design.md 002-diagram.json', files.join(' '))
  check('the earlier revision still shows the old design', readFileSync(join(root, 'attempts', 'default', 'revisions', '001-design.md'), 'utf-8').includes('no_backup'))

  // The reviewer is told to read a stable path; revisions are for archaeology.
  check('design.md tracks the latest revision', doc.includes('revision: 2'))
  check('diagram.json is refreshed alongside', (await store.loadDiagram())?.nodes.length === 3)

  for (const [name, pass, detail] of checks) {
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
  }
  const failed = checks.filter(([, pass]) => !pass)
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
  assert.equal(failed.length, 0)
} finally {
  rmSync(root, { recursive: true, force: true })
}
