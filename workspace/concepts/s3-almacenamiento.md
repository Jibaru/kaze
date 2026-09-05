---
id: s3-almacenamiento
title: S3 — presigned uploads, event notifications and storage classes
title_es: S3 — subidas con presigned URL, notificaciones y clases de almacenamiento
service: S3
difficulty: 1
steps: 5
---

## What this is about

Why large files should never pass through your API, how S3 tells the rest of the
system that something arrived, and what a lifecycle policy is actually deciding.

## What must be understood by the end

1. **The upload should not go through your compute.** A presigned URL lets the
   browser write straight to S3. Proxying a two-gigabyte file through a function
   costs the memory, the time and the request timeout, and buys nothing. The API
   issues permission; the bytes never touch it.
2. **A presigned URL is a signed grant, not a session.** It carries the method,
   the key and an expiry, and anyone holding it has exactly that. Short expiries
   and a key derived from something the server controls, not from the file name
   the client sent.
3. **S3 tells you when the object exists, not before.** An event notification
   fires on completion and drives everything downstream — a queue, a function,
   the thumbnail. Polling for the object, or having the client call your API to
   say it finished, are both worse: the client can lie or die.
4. **The event is at-least-once, and out of order.** Two notifications for one
   upload is normal. The consumer has to be idempotent, which is the same lesson
   as everywhere else.
5. **Storage classes are a decision about retrieval, not about size.** Standard,
   infrequent access, and the archive tiers differ mostly in what it costs and
   how long it takes to read something back. A lifecycle rule automates the
   move; the question it answers is "how long until nobody will read this in a
   hurry".

<!-- CHECKS:START — hidden from the learner -->

## Check they actually understood

- A user uploads a two-gigabyte video. Draw the path. Where does the API appear?
  *(only to issue the presigned URL; the bytes go browser to S3)*
- What exactly does the presigned URL let the holder do, and for how long?
  *(one method on one key until the expiry — nothing else)*
- How does the thumbnail job learn the file arrived? Why not have the client
  tell you? *(an S3 event; the client may die after uploading, or lie)*
- The thumbnail is generated twice for one upload. Is that a bug in S3?
  *(no — notifications are at-least-once; the consumer must be idempotent)*
- Documents must be kept seven years and are almost never read after ninety
  days. What is the rule, and what does it cost you? *(a lifecycle transition to
  an archive class; retrieval becomes slow and is charged)*

Common wrong answers:

- "Upload through the API so we can validate it." Validate after the event, or
  constrain it in the presigned policy.
- "Use the client's file name as the key." That is a path traversal and a
  collision waiting to happen.
- "Glacier is just cheaper S3." It is cheaper storage and expensive, slow reads.

<!-- CHECKS:END -->
