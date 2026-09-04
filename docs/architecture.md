# Architecture

Director owns the loop. Livepeer Agent produces media. DKG stores useful memory and provenance.

The important behavior is not storage by itself. The important behavior is that stored DKG memory changes the next media attempt.

## Flow

1. A target output is loaded.
2. Director starts a fresh demo session. Reset only updates local app state; DKG is written when attempts exist.
3. Attempt 1 runs from the target only.
4. The judge scores the output.
5. Director writes a cumulative Run Ledger snapshot as an immutable, session-and-iteration-scoped Knowledge Asset.
6. Director writes the matching Improvement Memory snapshot as a second versioned Knowledge Asset.
7. Attempt 2 retrieves Improvement Memory before prompt creation.
8. The new output is judged and stored.
9. A receipt is exported for review.

## Boundary

DKG should hold graph-shaped facts, references, hashes, scores, and reviewable summaries. It should not hold secrets, private media, raw private prompts, local paths, or hidden reasoning.

Livepeer should remain the media execution layer. DKG should not be used as bulk video storage.

## Repair acceptance

- [x] Every attempt is persisted as a project-bound job before remote work starts.
- [x] Switching or creating a project cannot move or erase an in-flight attempt.
- [x] The UI shows running phases, durable failures, each artifact, and both Knowledge Asset snapshots per Try.
- [x] A DKG-assisted Try shows the sanitized observations actually used and a fingerprint of the newly composed prompt.
- [x] The blind judge receives only the target criteria and artifact.
- [x] Shared Knowledge Assets omit target text, criteria text, avoid text, prompt text, personal data, and secrets.
- [x] Each DKG snapshot uses an immutable session-and-Try-scoped asset name and is verified by readback.
