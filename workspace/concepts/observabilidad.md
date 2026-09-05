---
id: observabilidad
title: Observability — what to measure so an outage is a question you can answer
title_es: Observabilidad — qué medir para que una caída sea una pregunta con respuesta
service: CloudWatch
difficulty: 2
steps: 5
---

## What this is about

Every diagram in this app raises "nothing here monitors it" as a gap, and the
usual fix is to draw a box labelled CloudWatch, which fixes nothing. This is
about what you would actually need at three in the morning.

## What must be understood by the end

1. **Averages hide the outage.** A mean response time of 200 ms with a p99 of
   nine seconds is one percent of requests failing, which is your largest
   customer. Percentiles are the only latency numbers worth putting on a
   dashboard, and they do not average across instances.
2. **Measure the symptom, not the machine.** CPU is a cause; a user waiting is a
   symptom. Alert on rate, errors and duration — traffic, how much of it fails,
   and how long it takes — plus saturation of whatever is actually scarce.
3. **An alarm nobody acts on is worse than none.** It trains the team to ignore
   the channel. Every alarm needs someone who would do something, and something
   they would do; the rest are dashboards.
4. **A log without a correlation id is a diary.** One request crosses the
   gateway, a function and a queue. Without an id carried through all of them you
   cannot reconstruct what happened to *that* request, which is the only question
   anyone ever asks.
5. **Instrument the boundaries.** Every call out — to a database, a queue, a
   third party — needs its own latency and error rate. Almost every incident is a
   dependency, and the dependency is exactly the part your own metrics do not
   describe.

<!-- CHECKS:START — hidden from the learner -->

## Check they actually understood

- Average latency is flat and support says the site is slow. What are you
  looking at, and what should you look at? *(the average; the p99, and the error
  rate)*
- Would you alert on CPU at eighty percent? What would you alert on instead?
  *(usually not — on errors, latency and saturation of the scarce resource)*
- A request fails somewhere between the gateway, a function and a queue
  consumer. What must be true to trace it? *(one correlation id, propagated and
  logged at each hop)*
- Everything you own looks healthy and requests are failing. What did you not
  instrument? *(the calls out — the dependency)*
- The team ignores an alarm that fires twice a week. What is the actual problem?
  *(the alarm; either it means something and nobody acts, or it does not and it
  is training everyone to ignore the channel)*

Common wrong answers:

- "We have CloudWatch." That is a place to put metrics, not a set of them.
- "We log everything." Volume is not observability; a question you can answer is.
- "We alert on every error." Then nobody reads them.

<!-- CHECKS:END -->
