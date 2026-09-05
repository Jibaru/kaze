---
id: rds-conexiones
title: RDS — connections, replicas and what Multi-AZ is not
title_es: RDS — conexiones, réplicas y qué NO es Multi-AZ
service: RDS
difficulty: 2
steps: 6
---

## What this is about

The three things people get wrong about a relational database sitting behind
compute that scales: what Multi-AZ actually buys, what a read replica actually
buys, and why the connection count is what fails first.

## What must be understood by the end

1. **Multi-AZ is availability, not capacity.** The standby serves nothing. It
   exists so a failover has somewhere to go, and a failover is a DNS change
   taking tens of seconds during which writes fail. It does not make anything
   faster and it does not double your read throughput.
2. **A read replica is capacity, not availability.** It is asynchronous, so it
   lags, and reading your own write from a replica returns stale data. Sending
   the wrong query to a replica is a correctness bug that appears only under
   load, when the lag grows.
3. **Connections are a hard and small resource.** A mid-size instance tops out in
   the low hundreds. Compute that scales to a thousand and opens one connection
   each does not need a bigger instance; it needs a pool that is not per-instance
   — a proxy, or a pooler in front.
4. **The failure is the pool, not the CPU.** A database at twenty percent CPU
   refusing connections is the normal shape of this outage, and it is why "use a
   bigger instance" does not fix it.
5. **A failover breaks every open connection.** The application has to reconnect
   and retry. An application that treats a connection as permanent turns a
   sixty-second failover into an hour of downtime.
6. **Backups are a policy, not a checkbox.** A retention window gives you a
   restore point; the numbers that matter are how much data you are willing to
   lose and how long a restore takes, and neither is the default.

<!-- CHECKS:START — hidden from the learner -->

## Check they actually understood

- Reads have tripled. Does Multi-AZ help? Why not? *(no — the standby serves
  nothing; you want a replica or a cache)*
- A user updates their profile and immediately sees the old value. What did the
  architecture do? *(read a replica; the write has not propagated yet)*
- Compute scales to eight hundred concurrent against a database at fifteen
  percent CPU, and requests start failing. What is the resource? *(connections)*
- Why does a bigger instance not fix that, and what does? *(the ceiling barely
  moves with size; a proxy or pooler decouples client count from connections)*
- The primary fails over cleanly in forty seconds and the site is down for
  twenty minutes. What is the application doing wrong? *(holding a dead
  connection — not reconnecting, or not retrying)*

Common wrong answers:

- "Multi-AZ gives me a read replica." It gives a standby you cannot read.
- "Use a bigger instance." The connection ceiling barely moves.
- "Point everything at the replica." Then reads are stale, unpredictably.

<!-- CHECKS:END -->
