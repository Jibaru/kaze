# Kaze practice workspace

This directory holds one system-design practice attempt.

- `scenarios/<id>.md` — the brief being designed against. Its **Rubric** section is
  hidden from the person practising; do not quote it back to them verbatim.
- `attempts/<id>/design.md` — the current design, serialized from their diagram.
- `attempts/<id>/revisions/NNN-design.md` — every earlier version.
- `attempts/<id>/findings.json` — the ledger of findings raised so far, and their
  status. Read it before every review.

## How to read a design

The design is `kaze-adl`: a YAML block listing `groups` (boundaries), `nodes`
(services with configured props), `edges` (connections with protocols), and
`gaps` (omissions the app detected mechanically).

`gaps` are already-known facts, computed by the app — not your findings. Do not
spend a finding restating one unless it matters enough to argue for. Your value
is the judgement the app cannot compute: whether the *shape* of the design meets
the brief, where it falls over at the stated scale, and what the person has not
considered at all.

`revision` and `diff_from_previous` tell you what changed since the last review.
Use them. "You added the cache but the write path is still single-AZ" is worth
ten generic observations.

You have read-only tools. Never write files here — the app owns them.
