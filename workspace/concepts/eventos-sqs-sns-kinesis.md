---
id: eventos-sqs-sns-kinesis
title: Choosing between SQS, SNS, EventBridge and Kinesis
title_es: Elegir entre SQS, SNS, EventBridge y Kinesis
service: EventBridge
difficulty: 3
steps: 5
---

## What this is about

Four AWS services that all "move messages around" and answer completely
different questions. Picking the wrong one is not a performance problem; it is a
design that cannot do what you will need next.

## What must be understood by the end

1. **A queue is work; a topic is news.** SQS holds tasks for one consumer group
   to do, once each, at their own pace. SNS fans an announcement out to whoever
   subscribed and forgets it. "Should the sender care whether anyone is
   listening?" separates them.
2. **Fan-out is a topic in front of queues.** SNS to several SQS queues gives
   every consumer its own buffer, its own retries and its own dead letter queue.
   Subscribing compute directly to a topic gives none of that, and the first
   slow consumer is the one that finds out.
3. **EventBridge is a topic with routing and a schema.** Rules match on the
   content of the event, so the sender does not have to know its audience. That
   is what makes it the right default for events between services and the wrong
   tool for a work queue.
4. **A stream is not a queue.** Kinesis keeps an ordered log per shard that
   several consumers read independently, each at its own position, and replay it.
   Order and replay are the reasons to accept shard management; if you need
   neither, you wanted a queue.
5. **Ordering costs throughput, everywhere.** A FIFO queue, a Kinesis shard and a
   partition key are all the same bargain: order within a key, paid for in
   parallelism. Design the key so that things that must be ordered share one, and
   nothing else does.

<!-- CHECKS:START — hidden from the learner -->

## Check they actually understood

- An order is placed. Billing, the warehouse and analytics all need to know.
  What goes in the middle, and why not a queue? *(a topic, or EventBridge — a
  queue delivers each message once, to one of them)*
- Same case, but the warehouse consumer is slow and sometimes fails. What
  changes? *(a queue per subscriber behind the topic, so each gets its own
  buffer and retries)*
- You need to reprocess yesterday's events after fixing a bug. Which of the four
  lets you, and what did it cost to have that? *(Kinesis; shards to manage and
  ordering constraints)*
- Two events for the same user must be processed in order. How, and what do you
  give up? *(one partition key or message group; parallelism within that key)*
- When is EventBridge the wrong answer? *(as a work queue — no per-consumer
  buffering, and the semantics are announcement, not task)*

Common wrong answers:

- "SNS with a Lambda subscriber is fan-out." It is, until one subscriber is slow
  or failing and has nowhere to put the backlog.
- "Kinesis is a faster SQS." It is an ordered, replayable log; the shard is the
  unit of both order and throughput.
- "More shards or more FIFO groups will fix the ordering." Order is per key by
  definition; more keys is less order, not more speed.

<!-- CHECKS:END -->
