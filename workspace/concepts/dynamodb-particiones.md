---
id: dynamodb-particiones
title: DynamoDB — partitions and hot keys
title_es: DynamoDB — particiones y claves calientes
service: DynamoDB
difficulty: 2
steps: 5
---

## What this is about

Why a DynamoDB table that looks fast in testing throttles in production, and why
the answer is almost always the partition key rather than the capacity setting.

## What must be understood by the end

1. **The partition key decides where an item lives.** It is hashed, and the hash
   picks a physical partition. Items with the same partition key are stored
   together, sorted by the sort key.
2. **Throughput is per partition, not per table.** A table with plenty of spare
   capacity still throttles if one key takes most of the traffic — the classic
   hot partition.
3. **The access pattern comes before the schema.** You design the key from the
   queries you need, not from the entities you have; a relational schema copied
   into DynamoDB is the single most common mistake.
4. **A query is cheap, a scan is not.** Query reads one partition by key. Scan
   reads the table. A secondary index exists to make another access pattern a
   query rather than a scan.
5. **On-demand is not a fix for a hot key.** It removes the capacity planning,
   not the physics: a single partition still has a ceiling.

<!-- CHECKS:START — hidden from the learner -->

## Check they actually understood

- Your table stores events keyed by day. Traffic triples. What throttles, and
  why does raising the capacity not help? *(one partition per day; the hot one)*
- How would you spread that key without losing the ability to query a day?
  *(a suffix, and fan the query across the suffixes)*
- When is a scan the right answer? *(a table small enough that it does not
  matter, or an offline job — never a request path)*
- You need to look items up by two different attributes. What does that cost?
  *(a GSI, its own capacity, and eventual consistency)*

Common wrong answers:

- "Add capacity." Capacity is spread across partitions; a hot key is not a
  capacity problem.
- "Use a scan with a filter." The filter runs after the read; you pay for
  everything scanned.

<!-- CHECKS:END -->
