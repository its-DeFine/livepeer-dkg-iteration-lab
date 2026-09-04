# Architecture

Director owns the loop. Livepeer Agent produces media. DKG stores useful memory and provenance.

The important behavior is not storage by itself. The important behavior is that stored DKG memory changes the next media attempt.

## Flow

1. A target output is loaded.
2. Director starts a fresh demo session. Reset only updates local app state; DKG is written when attempts exist.
3. Attempt 1 runs from the target only.
4. The judge scores the output.
5. Director writes the attempt to a session-scoped Run Ledger Knowledge Asset.
6. Director writes distilled learning to a session-scoped Improvement Memory Knowledge Asset.
7. Attempt 2 retrieves Improvement Memory before prompt creation.
8. The new output is judged and stored.
9. A receipt is exported for review.

## Boundary

DKG should hold graph-shaped facts, references, hashes, scores, and reviewable summaries. It should not hold secrets, private media, raw private prompts, local paths, or hidden reasoning.

Livepeer should remain the media execution layer. DKG should not be used as bulk video storage.
