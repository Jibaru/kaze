# Kaze practice workspace

This directory holds one system-design practice attempt.

- `scenarios/<id>.md` — the brief being designed against. Its **Rubric** section is
  hidden from the person practising; do not quote it back to them verbatim.
- `attempts/<id>/design.md` — the current design, serialized from their diagram.
- `attempts/<id>/revisions/NNN-design.md` — every earlier version.
- `attempts/<id>/findings.json` — the ledger of findings raised so far, and their
  status. Read it before every review.
- `concepts/<id>.md` — lessons for study mode, each with a hidden **Checks**
  section. Nothing to do with a review: the lesson runs in its own session with
  no tools and never reads this file. Listed here so the directory is not a
  mystery.

## How to read a design

The design is `kaze-adl`: a YAML block listing `groups` (boundaries), `nodes`
(services with configured props), `edges` (connections with protocols), and
`gaps` (omissions the app detected mechanically).

`edges` are directed and the direction is meaningful: **`from` is whoever
initiates, `to` is whoever receives the call.** A service reading a database is
`service -> database`, because the service makes the request; the data coming
back is not a second edge. Judge coupling, failure propagation and where
retries and timeouts belong from that direction, and say so when an edge points
the wrong way — a datastore that only initiates calls into compute is almost
always a drawing mistake rather than a design.

Two node types are not AWS services:

- `service: Actor` is the person or system on the other end — a user, a partner,
  a cron somewhere else. It belongs outside every boundary. Its `scale` prop, if
  set, is the load the design has to carry, and is worth arguing with when it
  does not match the scenario.
- `service: Custom` is something the practitioner named themselves, because the
  palette had no entry for it. Read its `kind` and `label`, judge it on what
  they say it is, and do not assume an AWS service. If `kind` is vague, that
  vagueness is itself worth a finding: an unnamed component cannot be reasoned
  about.

`gaps` are already-known facts, computed by the app — not your findings. Do not
spend a finding restating one unless it matters enough to argue for. Your value
is the judgement the app cannot compute: whether the *shape* of the design meets
the brief, where it falls over at the stated scale, and what the person has not
considered at all.

`revision` and `diff_from_previous` tell you what changed since the last review.
Use them. "You added the cache but the write path is still single-AZ" is worth
ten generic observations.

You have read-only tools. Never write files here — the app owns them.
