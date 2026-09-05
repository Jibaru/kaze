---
id: lambda-concurrencia
title: Lambda — concurrency and cold starts
title_es: Lambda — concurrencia y arranque en frío
service: Lambda
difficulty: 2
steps: 6
---

## What this is about

How AWS Lambda actually runs your code: what an execution environment is, when
one is created, what "concurrency" counts, and why the first invocation of a new
environment is slower than the rest.

## What must be understood by the end

1. **An execution environment serves one request at a time.** Concurrency is not
   a setting, it is a measurement: the number of requests in flight. Ten requests
   at once means ten environments, whatever the memory setting says.
2. **A cold start is the creation of a new environment**, not a property of the
   function. Download the package, start the runtime, run the code outside the
   handler. Roughly 100–800 ms, and much longer for a large package or a VPC-
   attached function with no warm ENI.
3. **Code outside the handler runs once per environment.** That is where a
   database client belongs, and it is why a connection created inside the
   handler is a bug that only shows up under load.
4. **Reserved concurrency is a cap and a guarantee.** It reserves capacity from
   the account pool and also limits the function to it; provisioned concurrency
   is different — it keeps environments warm and is billed for.
5. **Throttling is the account limit, not the function.** Past the account
   concurrency limit a synchronous invoke returns 429 and an asynchronous one is
   retried. What a downstream service sees is a burst equal to the concurrency,
   which is how Lambda takes a database down.
6. **Timeouts compound downstream.** A 15-minute function holding a connection is
   15 minutes of a connection pool, and the caller's own timeout is the one that
   decides what the user sees.

<!-- CHECKS:START — hidden from the learner -->

## Check they actually understood

Ask these as the lesson goes, not at the end. A right-sounding answer that
repeats the words back is not understanding; push once on each.

- With a thousand requests at once, how many environments exist, and what does
  the memory setting have to do with it? *(none — memory is per environment)*
- Where do you create the database client, and why does the other place work
  fine in testing? *(outside the handler; under no load every request gets a
  fresh cold environment anyway, so the bug is invisible)*
- Your function is throttled at 429. Is that the function's limit or the
  account's? What happens to an asynchronous invoke instead? *(account; retried
  with backoff, then the DLQ)*
- A Lambda behind an API Gateway writes to an RDS Postgres. Traffic multiplies by
  ten. What breaks first, and why is it not Lambda? *(connections — Lambda scales
  and the database does not)*
- What does provisioned concurrency actually buy, and what does it cost when
  traffic is flat? *(warm environments; you pay for them idle)*

Common wrong answers worth naming when they come up:

- "More memory makes it handle more requests at once." No — memory is per
  environment, and concurrency is how many environments there are.
- "Cold starts are fixed by keeping the function warm with a ping." One ping
  keeps one environment warm; a burst of a hundred is a hundred cold starts.
- "Reserved concurrency makes it faster." It caps it. Provisioned makes it warm.

<!-- CHECKS:END -->
