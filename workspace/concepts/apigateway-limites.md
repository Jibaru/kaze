---
id: apigateway-limites
title: The edge — throttling, timeouts and where authentication belongs
title_es: El borde — throttling, timeouts y dónde va la autenticación
service: APIGateway
difficulty: 2
steps: 5
---

## What this is about

The front door decides what reaches everything behind it. This is about the two
limits that bite — the request timeout and the rate limit — and about doing
identity once, at the edge, instead of in every handler.

## What must be understood by the end

1. **The edge has its own timeout, and it is short.** An API Gateway request is
   capped around thirty seconds whatever the function's own timeout says. Work
   that may take longer does not belong on a synchronous request: accept it,
   return an identifier, and do it behind a queue.
2. **Throttling at the edge is what protects everything behind it.** A rate limit
   and a burst limit per key are the cheapest backpressure in the system, and
   they are applied before your compute is paid for. Without them, the first
   traffic spike reaches the database.
3. **Authenticate once, at the edge.** An authorizer at the gateway means the
   handlers receive a request that has already been proven; identity in each
   handler is the same check written many times and forgotten in one of them.
4. **Authorization is not authentication, and it is not at the edge.** The
   gateway can tell you who it is. Whether that person may touch this particular
   record is a question only the handler has the data to answer, and putting it
   in a token is how objects get read by the wrong tenant.
5. **The cache at the edge is the cheapest one you have.** A response cached at
   the gateway or in front of it never reaches your compute at all. It is also
   the one most likely to be keyed wrong: cache on everything that changes the
   answer, including the identity when the answer is per-user.

<!-- CHECKS:START — hidden from the learner -->

## Check they actually understood

- A report takes two minutes to build. Draw the request. *(accept, return an id,
  queue it; poll or notify — never hold the connection)*
- Traffic multiplies by twenty. What at the edge decides whether the database
  notices? *(the rate and burst limits)*
- Where does "is this a valid user" go, and where does "may this user read
  invoice 91" go? Why not both in the same place? *(the first at the edge; the
  second in the handler, which has the record)*
- You cache a per-user response at the edge keyed only by the path. What
  happens? *(one user is served another's data — the identity is part of what
  makes the answer)*
- Why is edge throttling cheaper than throttling inside the application? *(the
  request is rejected before any of your compute runs)*

Common wrong answers:

- "Raise the gateway timeout." It is a hard ceiling; the design is wrong.
- "Put the permissions in the JWT." Fine for roles, wrong for per-record
  access, which changes without a new token.
- "The load balancer will absorb the spike." It forwards it.

<!-- CHECKS:END -->
