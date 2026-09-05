---
id: cache-invalidacion
title: Caching — the read path, the stampede and the stale window
title_es: Caché — el camino de lectura, la estampida y la ventana de datos viejos
service: ElastiCache
difficulty: 3
steps: 6
---

## What this is about

A cache is the cheapest way to make a read-heavy system fast and the easiest way
to make it wrong. What it actually promises, what it costs when it is empty, and
what happens the moment the data changes.

## What must be understood by the end

1. **A cache is a bet that the same thing is read many times.** The hit rate is
   the whole economics: at ninety percent the database sees a tenth of the
   traffic; at fifty percent you have added a network hop to half your reads and
   bought very little.
2. **Cache-aside is the default shape.** Read the cache; on a miss read the
   database and write it back. The application owns the policy, which is why the
   application also owns every bug in it.
3. **A miss on a hot key is a stampede.** A thousand concurrent readers all miss
   at once and all query the database at once — precisely at the moment the
   cache was supposed to protect it. The answer is single-flight, a short lock or
   an early refresh, not a longer TTL.
4. **The TTL is a decision about staleness, not about memory.** Sixty seconds
   means someone may see sixty-second-old data. That is fine for a click count
   and not fine for a permission check, and the number should come from that
   question rather than from a default.
5. **Invalidation is a distributed systems problem.** Deleting the key on write
   is right and still races with an in-flight read that is about to write a stale
   value back over it. Writing through the cache avoids that race and couples the
   write path to the cache's availability instead.
6. **A cache that must be up is not a cache.** If a cold one takes the system
   down, it is a database with a short memory. The system has to survive an empty
   cache, at reduced speed.

<!-- CHECKS:START — hidden from the learner -->

## Check they actually understood

- A viral link expires from the cache at peak. Describe the next second.
  *(every reader misses; the database takes the whole burst; the cache refills
  after the damage is done)*
- How do you stop that without raising the TTL? *(single-flight or a short lock
  so one reader refills; refresh early, before expiry)*
- Where does the sixty-second TTL come from? *(how stale the answer may be, not
  how much memory you have)*
- You delete the key on write. What can still go wrong? *(a read that missed
  before the delete writes the old value back after it)*
- The cache node restarts. Does the site stay up? *(it must — slower, not down;
  otherwise it was never a cache)*

Common wrong answers:

- "Raise the TTL to avoid stampedes." It makes them rarer and worse.
- "Write to the cache and then to the database in the application." A crash
  between the two leaves them disagreeing, with nothing to notice it.
- "Cache everything." Anything read once costs a write and a hop and returns
  nothing.

<!-- CHECKS:END -->
