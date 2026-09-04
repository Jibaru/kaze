# Kaze — voice-driven AWS system design practice

> Plan produced by a `grill-me` session, 2026-09-03. Every decision below was
> put to the user and confirmed. Sections marked **VERIFIED** were checked
> against the installed toolchain, not recalled.

## 0. The product in one paragraph

A desktop app for practising AWS system design. You pick a scenario, draw an
architecture on a canvas with real AWS service icons, hold a key and say
*"review this"*. Your **installed Claude Code** — same binary, same OAuth
login, same skills, no API key — reads the diagram as text, reviews it against
a Well-Architected-derived rubric, **speaks** a summary and populates a
findings panel you can read. You change the diagram and review again; findings
you fixed flip to **resolved**. That last sentence is the product.

---

## 1. Settled decisions

| # | Decision | Choice | Why |
|---|---|---|---|
| 1 | Claude Code integration | App owns a long-lived headless session via `@anthropic-ai/claude-agent-sdk` | Same binary + OAuth + `.claude/` skills as the terminal, but structured JSON events instead of scraped ANSI |
| 2 | Desktop shell | Electron + React + Vite + TypeScript | Child-process streaming and `getUserMedia` are solved paths; size is irrelevant here |
| 3 | Canvas | React Flow (xyflow) | Typed graph model → exact serialization. Excalidraw/draw.io make you infer topology from arrow geometry |
| 4 | Voice | Push-to-talk + OpenAI REST STT/TTS | A review is a punctuated command, not a conversation. No VAD tuning, no hot mic |
| 5 | Practice loop | Scenario-driven, markdown scenario bank; interview mode later | Critique without requirements is trivia |
| 6 | AWS knowledge | Vendored WA reference corpus + one thin `kaze-review` skill + AWS Knowledge MCP | The model already knows AWS; what it lacks is a *consistent rubric* |
| 7 | Diagram → text | Purpose-built YAML DSL **with a `gaps:` section** | A diagram's omissions are what an interviewer attacks, and they are invisible in every format that only lists what you drew |
| 8 | Review output | Streamed markdown + a closing fenced JSON block | One turn produces both the readable surface and the machine-readable one |
| 9 | Voice output | Single TTS call on `spoken_summary`; mic key cuts playback | You waited 30s for the review; 1s for audio is noise. Replay is free |
| 10 | Persistence | App-owned `workspace/`; Claude **reads the design off disk** | Claude Code working the way it is built to; enables "what did I have before the queue?" |
| 11 | Scenarios | Markdown + frontmatter, **hidden rubric section** | If you can read the answer key you are not practising |
| 12 | Layout | 3 columns + persistent voice bar | — |
| 13 | Intent | **Two keys**: *Review* (rubric pass) vs *Ask* (plain turn) | Intent classification will misfire; a physical distinction never does |
| 14 | Diffing | Every review snapshots a numbered revision; app passes a computed graph diff | Cheap to compute, saves the model re-deriving it |
| 15 | Findings | **Stateful ledger** with `new` / `still open` / `resolved` / `regressed` | Stateless review #4 is just review #1 with more words |
| 16 | Context growth | Ledger lives on disk and is re-read each review | Compaction becomes harmless |
| 17 | Icons | `@aws-icons/react` + hand-written `services.ts` manifest | The icon is decoration; the manifest is what makes serialization mean something |
| 18 | Security | Main process owns SDK + fs + OpenAI key (`safeStorage`); renderer sandboxed | Key never enters the renderer |
| 19 | v1 cut line | One scenario, one attempt, loop closed, **a finding flips to resolved** | — |

---

## 2. Architecture

```
┌─ Electron main (privileged) ──────────────────────────────────────┐
│                                                                   │
│  SessionManager ──spawns──> claude CLI (OAuth, no API key)        │
│    query() / streamInput() / interrupt()                          │
│                                                                   │
│  WorkspaceStore    scenarios, attempts, revisions, findings.json  │
│  FindingsLedger    reconciliation + status computation            │
│  VoiceService      OpenAI transcribe / speak (key in safeStorage) │
│                                                                   │
└───────────────── contextBridge (typed, narrow) ───────────────────┘
┌─ Renderer (sandboxed: contextIsolation, no node integration) ─────┐
│  ScenarioPanel │ ReactFlow canvas + AWS nodes │ ReviewPanel       │
│  ServicePalette│  groups: VPC / AZ / subnet   │ transcript        │
│  ────────────── VoiceBar: hold ⎵ review · hold ⌥ ask ─────────────│
└───────────────────────────────────────────────────────────────────┘
```

---

## 3. Claude Code integration — **VERIFIED** against `@anthropic-ai/claude-agent-sdk@0.3.260`

CLI on this machine: `claude 2.1.260` at `/c/nvm4w/nodejs/claude`.

This exact configuration is **executed and asserted** by `spike/run.mjs`
(12/12 checks, ~$0.07 per run). It is not a sketch.

```ts
import { query } from '@anthropic-ai/claude-agent-sdk'

const q = query({
  prompt: inputStream,               // AsyncIterable<SDKUserMessage> for multi-turn
  options: {
    cwd: attemptDir,                 // workspace/attempts/<id>
    resume: savedSessionId,          // undefined on first turn; captured from the init message
    forkSession: false,              // continue the SAME session id

    settingSources: ['project'],     // NOT 'user' — see below
    strictMcpConfig: true,
    skills: ['kaze-review'],

    disallowedTools: [...WRITE_TOOLS, ...NETWORK_TOOLS, ...ORCHESTRATION_TOOLS],
    canUseTool: allowlist,           // Read | Grep | Glob | Skill | mcp__aws-knowledge__*
    permissionMode: 'default',

    mcpServers: {
      'aws-knowledge': { type: 'http', url: 'https://knowledge-mcp.global.api.aws' },
    },
    includePartialMessages: true,    // stream text deltas into the transcript
  },
})
```

`query()` returns a `Query extends AsyncGenerator<SDKMessage>` exposing
`.streamInput(stream)`, `.interrupt()` and `.setModel()` — `sdk.d.ts:2586–2922`.

### Gotchas, each one found the hard way in the spike

- **`canUseTool` is silently shadowed by `allowedTools`.** A bare tool name in
  `allowedTools` auto-approves that tool *before* the callback runs, turning
  the backstop into a no-op. The SDK warns (`CLAUDE_SDK_CAN_USE_TOOL_SHADOWED`)
  — but **allow-rules in the user's settings files shadow it identically and
  warn about nothing.** So: `canUseTool` is the allowlist, `allowedTools` stays
  empty, and anything that must never happen goes in `disallowedTools`, which
  is the only layer nothing overrides.
- **`settingSources: ['user', …]` drags the user's entire global config into
  the reviewer.** The first passing spike run inherited every MCP server on
  this machine — including one that can delete databases and applications —
  plus `Task`, `Workflow`, `CronCreate`, `RemoteTrigger`, `SendMessage`. A
  diagram reviewer holding production-delete tools is an obvious own-goal, and
  it passed every check I had written at that point. `settingSources:
  ['project']` + `strictMcpConfig: true` + denying the orchestration tools
  cuts the session down to exactly `Glob, Grep, Read, Skill, ToolSearch`.
  **Assert the offered toolset, don't assume it** — the `system/init` message
  carries `tools`, so this is a free check on every session.
- `settingSources` must include `'project'` for the workspace `CLAUDE.md` to
  load. `'project'` resolves against `cwd`, so the workspace gets its own
  config and the user's global one stays out.
- `skills` is a *context filter, not a sandbox* — unlisted skills are hidden
  from the Skill tool but their files stay readable. No secrets in skill files.
- **Never use `--bare` / bare mode.** Its documented behaviour is "Anthropic
  auth is strictly `ANTHROPIC_API_KEY` or apiKeyHelper; OAuth and keychain are
  never read" — exactly what we are avoiding.
- Read-only tools + `canUseTool` mean **no permission prompts and no
  `bypassPermissions`**. The reviewer never writes; the app writes the files.
- Non-interactive mode skips the workspace trust dialog. Confirmed.
- A model refusing to do something is **not** proof it cannot. Turn 3 of the
  spike asks it to write a file; it declined on its own before any deny fired.
  Test the mechanism (is the tool even in the session?), not the manners.

---

## 4. Repo layout

```
kaze/
  package.json                  electron-vite
  src/main/
    index.ts                    app lifecycle, window
    session-manager.ts          Agent SDK lifecycle, per-attempt sessions
    workspace-store.ts          fs: scenarios, attempts, revisions
    findings-ledger.ts          reconciliation + status
    voice-service.ts            OpenAI STT/TTS, safeStorage key
    ipc.ts                      typed channel registry
  src/preload/index.ts          contextBridge surface
  src/renderer/
    App.tsx
    canvas/                     ReactFlow, node types, group nodes
    palette/                    service search
    review/                     findings panel, transcript
    voice/                      push-to-talk, playback, barge-in
    serialize/adl.ts            graph -> DSL + gaps
  src/shared/
    services.ts                 AWS service manifest (icon + review metadata)
    types.ts                    Finding, Attempt, Revision, AdlDoc
  workspace/                    seed, copied to userData on first run
  vendor/well-architected/      MIT-0 corpus (keep LICENSE)
```

---

## 5. Workspace layout (the Claude Code cwd)

```
workspace/
  CLAUDE.md                     how to review here; points at the corpus
  .claude/skills/
    kaze-review/SKILL.md        the thin rubric skill (ours)
  references/                   vendored WA best-practice corpus (MIT-0)
  scenarios/
    url-shortener.md            frontmatter + reqs + HIDDEN rubric
  attempts/<attempt-id>/
    meta.json                   scenario id, session id, created
    design.md                   latest serialized diagram
    revisions/001-design.md …   snapshot per review
    findings.json               THE LEDGER — read first by every review
    audio/                      spoken summaries, replayable
```

**Vendoring:** copy `skills/*/references/` from
[`aws-samples/sample-well-architected-skills-and-steering`](https://github.com/aws-samples/sample-well-architected-skills-and-steering)
(MIT-0, 307 best practices across 57 questions) into `references/`, keeping its
LICENSE. We deliberately do **not** use its `aws-well-architected-framework-review`
skill directly: that skill assesses a real production workload and emits a full
BP ledger with citations. Pointed at a 12-node practice diagram it produces a
40-page audit, not interview feedback. It is the knowledge base; `kaze-review`
is the reviewer.

---

## 6. The serialization DSL (`kaze-adl`)

```yaml
scenario: url-shortener
revision: 4
diff_from_previous:
  added_nodes: [n7 ElastiCache]
  added_edges: [n3 -> n7]
  changed_props: []
groups:
  - { id: vpc,  kind: vpc, cidr: 10.0.0.0/16 }
  - { id: az-a, kind: az,  parent: vpc }
nodes:
  - { id: n1, service: CloudFront, label: CDN }
  - { id: n2, service: ApplicationLoadBalancer, group: vpc }
  - { id: n5, service: RDS, group: az-a, props: { engine: postgres } }
edges:
  - { from: n1, to: n2, protocol: HTTPS }
  - { from: n2, to: n3 }
gaps:
  - unconnected_node: "n7 (ElastiCache) has no inbound or outbound edges"
  - untyped_edge: "n2 -> n3 has no protocol"
  - single_az: "n5 (RDS) sits in one AZ group with no multi_az prop"
  - no_backup: "n5 has no backup or retention prop"
```

The `gaps:` section is computed by the app from the graph, never by the model.
It is the difference between a reviewer that critiques your drawing and one
that critiques your *design*.

---

## 7. `kaze-review` skill contract

The skill instructs: read `findings.json` first, then `design.md`; produce a
markdown review of **at most one page with 5–8 findings**, citing WA best
practices by id into `references/`; close with a fenced JSON block:

```json
{
  "verdict": "needs_work",
  "spoken_summary": "About 120 words of plain prose, no ids, written to be heard.",
  "findings": [
    {
      "id": "f-db-single-az",
      "severity": "high",
      "pillar": "reliability",
      "bp_id": "REL13-BP02",
      "nodes": ["n5"],
      "claim": "The primary datastore is single-AZ, so an AZ failure loses the write path.",
      "fix": "Enable Multi-AZ, or move to Aurora with a reader in a second AZ."
    }
  ],
  "resolved": ["f-no-cache"]
}
```

`spoken_summary` is what TTS reads; the markdown and findings are what you
read. One turn, both surfaces, no second call, and no `--json-schema`
fighting the multi-turn conversation.

---

## 8. Findings ledger + reconciliation

The app — not the model — owns finding identity.

1. Parse the JSON block (extract the last fenced `json` block).
2. Match each incoming finding against **open** ledger entries: same node set
   ∩ same pillar, then claim similarity (token-set ratio > 0.6). The model's
   `id` is a **hint, not gospel**.
3. Status:
   - matched an open entry → `still open`
   - no match → `new`
   - open entry not re-raised, or listed in `resolved` → `resolved`
   - previously-resolved entry re-raised → `regressed`
4. Write `findings.json`. The panel groups by status; resolved items collapse
   into a green `fixed (3)` strip. Clicking a finding highlights its nodes on
   the canvas.

Because the ledger lives on disk and every review re-reads it, mid-attempt
auto-compaction is harmless.

---

## 9. Voice pipeline

- **Hold ⎵** → `getUserMedia` → webm/opus blob → main → OpenAI
  `gpt-4o-transcribe` → text → *review* intent.
- **Hold ⌥** (second key) → same path → *ask* intent: plain conversational
  turn, no findings block, no panel churn.
- Transcript appears immediately; the review streams into the panel.
- On JSON block arrival → `gpt-4o-mini-tts` on `spoken_summary` → single mp3 →
  play, and keep it under `attempts/<id>/audio/` for replay.
- **Barge-in:** any mic key press stops playback instantly and, if a turn is
  in flight, calls `q.interrupt()`.

---

## 10. IPC surface (narrow and typed)

```
scenario:list            scenario:load
attempt:create           attempt:load
design:save(adl)         -> writes design.md + revision snapshot
review:run(intent)       -> streams { text_delta | tool_use | result }
findings:get
voice:transcribe(blob)   -> string
voice:speak(text)        -> audio path
voice:cancel
settings:setOpenAIKey    -> safeStorage
```

---

## 11. Build order

| Phase | Work | Exit criterion |
|---|---|---|
| **0. Spike** ✅ | `spike/run.mjs` — session resume, skill load, scoped read-only toolset | **DONE. 12/12.** Skill fires, `Read` off disk, deltas stream, resume carries context with no re-read, session offers only `Glob, Grep, Read, Skill, ToolSearch`, no API key, no prompt |
| **1. Shell** ✅ | Electron + React Flow + 28-service manifest + palette + boundary groups + inspector | **DONE. 13/13 round-trip checks.** A 10-node design with nested VPC/AZ boundaries, configured props and typed edges survives flow → save → flow → save byte-identically; app reopens it from disk |
| **2. Serializer** ✅ | `adl.ts` (9 gap rules + diff), revision snapshots, live Design-text panel | **DONE. 28 + 12 checks.** Every gap fires on a flawed design and clears when fixed; revisions diff against the previous one; the panel shows exactly what the reviewer will read |
| **3. Round-trip** ✅ | workspace scaffold, `kaze-review` skill, SessionManager, findings parser, review panel | **DONE. 20 + 14 checks (14 live).** A weak design gets `does_not_meet_brief`, 7 findings with stable ids pointing at real nodes, a 128-word spoken summary, and the review engages the hidden rubric |
| **4. Ledger** ✅ | reconciliation, statuses, fixed-strip, canvas highlight | **DONE. 19 + 7 checks (7 live).** Fixed the DB, re-reviewed: that finding flipped to `resolved`, the other 7 stayed `open` across a fully regenerated review, and a new finding appeared as a consequence of the fix |
| **5. Voice** ✅ | push-to-talk, `gpt-4o-transcribe`, `gpt-4o-mini-tts`, barge-in, replay, DPAPI key | **DONE. 18 live checks.** Held the mic, spoke, got a review and a spoken summary. AWS vocabulary survives the round trip; silent audio is gated before it reaches the transcriber |

Phase 0 goes first and alone. Everything downstream is worthless if the session
model does not behave, and it is 40 lines to find out.

---

## 12. Risks, and what to do about them

- ~~**Skill discovery / workspace trust in a non-git dir.**~~ Resolved in Phase 0:
  skills resolve from the workspace `.claude/`, no trust dialog.
- **Config drift re-widening the session.** The reviewer's toolset is a
  security boundary, and the default configuration quietly gives it far more
  than it needs. → Keep the `system/init` toolset assertion in the app itself,
  not just in the spike: refuse to run a review if the session offers anything
  outside the allowlist.
- **Model drifts from the JSON block format.** → Extract leniently; on parse
  failure send one corrective turn ("re-emit only the JSON block"), then
  degrade to markdown-only rather than erroring.
- **Reconciliation false-positives** merging two genuinely different findings.
  → Keep the raw model output per revision so mis-merges are debuggable, and
  bias the threshold toward `new`: a duplicate is annoying, a silently
  swallowed finding is a lie.
- **Icon coverage gaps** in `@aws-icons/react`. → The manifest maps unknown
  services to a generic node; the manifest, not the icon set, is the source of
  truth.
- **AWS Knowledge MCP rate limits** (unspecified, unauthenticated). → Treat as
  best-effort; a failed MCP call must never fail a review.
- **Windows mic permission** on first capture. → Handled: the renderer asks, the
  main process grants `media` and denies every other permission, and a denial
  surfaces in the status bar rather than becoming a dead key.
- **A transcriber asked to transcribe silence does not return nothing.** It
  returns something plausible — the vocabulary prompt verbatim, or an invented
  fragment like `"context:"` — and the app would then run a review against words
  nobody said. Two guards: the renderer measures peak RMS off the live stream and
  never sends silent audio, and the transcript is rejected if it is mostly the
  prompt. The RMS gate is the one that matters; the echo check is a backstop.

---

## 13. Explicitly not in v1

Interview mode (Claude pushes back and scores you), multi-scenario progress
tracking, cost estimation, diagram export, and building around the Knowledge
MCP server (configure it, do not depend on it).

---

## Sources

- [aws-samples/sample-well-architected-skills-and-steering](https://github.com/aws-samples/sample-well-architected-skills-and-steering) — MIT-0
- [aws-samples/sample-claude-code-plugins-for-startups](https://github.com/aws-samples/sample-claude-code-plugins-for-startups) — MIT-0 (`aws-dev-toolkit` marked deprecated)
- [AWS Knowledge MCP Server](https://awslabs.github.io/mcp/servers/aws-knowledge-mcp-server) — `https://knowledge-mcp.global.api.aws`, no auth required
- [zxkane/aws-skills](https://github.com/zxkane/aws-skills) — MIT, IaC-flavoured
