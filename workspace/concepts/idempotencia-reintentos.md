---
id: idempotencia-reintentos
title: Retries and idempotency — why the network makes you do this
title_es: Reintentos e idempotencia — por qué la red te obliga
service: Lambda
difficulty: 3
steps: 5
---

## What this is about

Every distributed system retries, and every retry is a chance to do the same
thing twice. This is the cross-cutting concept behind half the findings in a
system design review: what a timeout actually tells you, and what has to be true
for a retry to be safe.

## What must be understood by the end

1. **A timeout tells you nothing about the server.** The request may have never
   arrived, arrived and failed, or arrived and succeeded with the reply lost. The
   caller cannot tell these apart, ever. Retrying is therefore a decision to
   accept a possible duplicate.
2. **Idempotency is a property of the operation, not of the client.** "Set the
   status to paid" is naturally idempotent; "add ten to the balance" is not. When
   the operation is not idempotent, the caller supplies a key and the server
   remembers it — that memory is the whole mechanism, and it needs a store and an
   expiry like anything else.
3. **Retry with exponential backoff and jitter, or do not retry.** Immediate
   retries turn a slow dependency into a stampede, and synchronized retries from
   a thousand clients arrive as one spike. Jitter is not a detail; it is what
   stops the herd re-forming.
4. **Retries need a budget and a circuit breaker.** Retrying a dependency that is
   down multiplies the load on it exactly when it can least take it. A breaker
   fails fast instead, and a budget caps what fraction of traffic may be retries.
5. **Somebody is retrying above you.** The client, the load balancer, the SDK and
   your own handler each retrying three times is twenty-seven requests for one
   click. Retries have to be owned at one layer, deliberately.

<!-- CHECKS:START — hidden from the learner -->

## Check they actually understood

- Your payment call times out. Did it go through? What do you do? *(unknowable;
  retry only with an idempotency key, or check first)*
- Which of these is safe to retry blindly: setting a status, incrementing a
  counter, appending to a list? *(only the first)*
- A dependency slows to two seconds and every caller retries immediately three
  times. What happens to it? *(four times the load, at its worst moment)*
- Why is jitter necessary if you already have backoff? *(a thousand clients
  backing off by the same amount retry at the same instant)*
- The SDK retries three times, the load balancer once, your handler twice. How
  many requests does one click become, and who should own that? *(many; one
  layer, chosen on purpose)*

Common wrong answers:

- "We use HTTPS so the request either arrives or it does not." The reply can be
  lost after the work is done.
- "The database transaction makes it idempotent." It makes it atomic. A second
  call runs a second atomic transaction.
- "We retry until it works." That is the definition of a retry storm.

<!-- CHECKS:END -->
