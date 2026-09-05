---
id: multi-az-multi-region
title: Availability — zones, regions, and what RTO and RPO actually commit you to
title_es: Disponibilidad — zonas, regiones, y a qué te compromete un RTO y un RPO
service: Route53
difficulty: 4
steps: 6
---

## What this is about

The difference between surviving a machine failure, a data-centre failure and a
region failure — and why the honest answer to "should we be multi-region" is
usually no, said with a reason.

## What must be understood by the end

1. **An availability zone is a failure domain, not a building you chose.** Two
   zones means an instance, a rack, a power supply or a whole data centre can go
   without taking the system with it. Multi-AZ is the default answer for
   availability because it is cheap, synchronous and inside one region.
2. **A region is a blast radius and a legal boundary.** Going multi-region buys
   you survival of a whole-region event, which is rare, and it costs you
   asynchronous replication, cross-region latency, and every consistency problem
   that comes with writing in two places.
3. **RTO is how long you may be down; RPO is how much data you may lose.** They
   are the only two numbers in this conversation, they come from the business,
   and every architecture below is downstream of them. An RPO of zero across
   regions is a synchronous write across a continent, and someone pays for that
   in latency on every request.
4. **Active-passive is a promise you have to test.** A standby region nobody has
   failed over to is a standby region that will not work. The failover mechanism
   — health check, DNS, TTL — is itself the thing most likely to fail.
5. **DNS failover is bounded by the TTL and by clients that ignore it.** Route 53
   can shift traffic in seconds; resolvers and connection pools hold on for
   longer. "We change DNS" is not an instant recovery plan.
6. **State is what makes it hard.** Stateless compute in two regions is an
   afternoon. Two writable copies of a database is a distributed systems project,
   which is why most honest answers are one writable region plus replicas, and an
   RPO measured in seconds rather than zero.

<!-- CHECKS:START — hidden from the learner -->

## Check they actually understood

- What does a second availability zone protect you from, and what does it not?
  *(a data centre; not a regional control-plane event, not a bad deploy)*
- The business says "we cannot lose any data and must be back in a minute".
  What has just been asked for, and what does it cost? *(RPO zero, RTO one
  minute — synchronous cross-region writes, paid in latency on every request)*
- You have a warm standby region. What is most likely to fail during a real
  failover? *(the failover itself: health checks, DNS TTL, a runbook nobody has
  run)*
- Why is "we will change DNS" not a one-minute RTO? *(TTLs and clients that hold
  connections and cached resolutions)*
- What makes multi-region hard, given compute is easy to duplicate? *(the
  database — two writable copies is a distributed systems problem)*

Common wrong answers:

- "Multi-AZ means multi-region." It is one region, several data centres.
- "We are multi-region because we replicate to another region." Replication is
  not failover; failover is the part that has to be tested.
- "Multi-region for availability." Usually the availability was lost to a bad
  deploy or a dependency, neither of which a second region fixes.

<!-- CHECKS:END -->
