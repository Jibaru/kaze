---
id: sqs-entrega
title: SQS — visibility timeout, retries and the dead letter queue
title_es: SQS — visibility timeout, reintentos y la cola de errores
service: SQS
difficulty: 2
steps: 6
---

## What this is about

What actually happens to a message between "sent" and "gone", why a queue that
looks fine reprocesses the same message forever, and why "exactly once" is a
promise nobody can make you.

## What must be understood by the end

1. **Reading a message does not remove it.** A consumer receives it and the queue
   hides it for the visibility timeout. Only an explicit delete removes it. A
   consumer that crashes after doing the work but before deleting will see the
   message again, and that is the whole reason idempotency matters.
2. **The visibility timeout must exceed the processing time.** Set it to thirty
   seconds for work that takes forty and the message comes back while the first
   consumer is still working on it — two consumers, same message, and the
   symptom is a duplicated side effect rather than an error.
3. **Retries are the queue's, not yours.** A failed handler simply does not
   delete; the message reappears after the timeout. The receive count counts
   those reappearances, and the dead letter queue is where a message goes when
   it runs out.
4. **A dead letter queue with no alarm is a bin.** The point of it is that
   somebody looks; nothing about it retries or notifies on its own.
5. **At-least-once, not exactly-once.** Standard queues can deliver twice and
   deliver out of order. FIFO gives order and deduplication within a group, at a
   fraction of the throughput. Make the handler idempotent and the distinction
   stops being frightening.
6. **The queue is not the backpressure.** A queue absorbs a burst; it does not
   protect what is downstream — the consumer's concurrency does. A consumer
   scaling to a thousand while the database takes fifty is a queue that
   forwarded the outage instead of preventing it.

<!-- CHECKS:START — hidden from the learner -->

## Check they actually understood

- A consumer does the work, writes to the database, and the process is killed
  before it deletes the message. What happens next, and what does the user see?
  *(redelivered after the timeout; the write happens twice unless it is
  idempotent)*
- Processing takes about forty seconds and the visibility timeout is thirty.
  Describe the failure. *(the message reappears mid-flight; two consumers do the
  same work; no error is raised anywhere)*
- Where does a message go after failing five times, and what happens then?
  *(the dead letter queue, and then nothing — it sits there unless something is
  watching)*
- Traffic multiplies by ten into a queue read by a function writing to a
  relational database. The queue drains fine. What breaks? *(the database — the
  consumer's concurrency is the backpressure, not the queue)*
- When is FIFO worth it? *(when order within a key genuinely matters and the
  throughput fits; otherwise make the handler idempotent)*

Common wrong answers worth naming:

- "SQS guarantees exactly-once." It does not; FIFO deduplicates within a window,
  which is not the same promise.
- "The dead letter queue retries them later." It does not. It is a place, not a
  process.
- "Adding a queue protects the database." It moves the load in time, and only if
  the consumer is limited.

<!-- CHECKS:END -->
