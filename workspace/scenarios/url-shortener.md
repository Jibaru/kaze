---
id: url-shortener
title: URL shortener at scale
difficulty: 1
---

## Brief

Design a URL shortener. Users submit a long URL and get back a short code; anyone
resolving that code is redirected to the original.

## Functional requirements

- Create a short code for a URL, optionally with a custom alias.
- Resolve a short code to its target with an HTTP redirect.
- Report click counts per code, refreshed within a minute or so.

## Non-functional requirements

- 100M redirects/day, peaking at roughly 10x the daily average for a few minutes.
- p99 redirect latency under 100ms, worldwide.
- Redirects are read-heavy: roughly 500 reads per write.
- Codes are permanent. Losing the code→URL mapping is unacceptable.
- Click counts may be approximate and may lag; the mapping may not.

## Constraints

- AWS only, single account.
- Budget matters: justify anything that scales with traffic rather than storage.

<!-- RUBRIC:START — hidden from the practitioner -->

## Rubric

A good answer must address:

1. **Read path is not the write path.** Redirects should be served from cache or
   an edge, not from the primary datastore on every hit. At 100M/day a
   database-per-redirect design fails on cost long before it fails on latency.
2. **Durability of the mapping.** The code→URL store must survive an AZ loss and
   have a stated backup story. "Unacceptable to lose" is in the brief.
3. **Code generation under contention.** Counter, hash-with-collision-check, or
   pre-generated key pool — any is fine, but the collision and uniqueness story
   must be explicit. Hash-and-hope is a finding.
4. **Click counting is decoupled.** Counting synchronously on the redirect path
   couples reads to writes and adds latency. A queue or stream feeding an
   aggregator is the expected shape; the brief explicitly permits lag.
5. **Global latency.** p99 < 100ms worldwide implies an edge/CDN tier or
   multi-region reads; a single-region ALB does not meet it.
6. **Peak handling.** 10x spikes for minutes mean either headroom, autoscaling
   with a realistic warm-up, or serverless. Autoscaling that takes five minutes
   does not survive a two-minute spike.

Common mistakes worth naming when present:

- Caching the mapping but still writing click counts synchronously.
- A relational primary with no read replicas and no cache.
- Custom aliases treated as an afterthought (they change the uniqueness story).
- No mention of what happens on a cache miss stampede for a viral link.

<!-- RUBRIC:END -->
