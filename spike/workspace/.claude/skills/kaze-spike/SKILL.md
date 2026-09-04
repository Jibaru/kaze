---
name: kaze-spike
description: Phase-0 spike rubric. Review a kaze-adl architecture diagram and report the single most severe finding. Use when asked to review design.md.
---

Read `design.md`, then reply in exactly this shape:

1. Begin your reply with the literal token `KAZE-SPIKE-OK` on its own line.
   This proves to the harness that the skill loaded.
2. State the **single most severe** finding: the node id, the Well-Architected
   pillar, and one sentence on why it matters.
3. Pay attention to the `gaps:` section — omissions matter more than what was
   drawn.

Do not write files. Do not review more than one finding.
