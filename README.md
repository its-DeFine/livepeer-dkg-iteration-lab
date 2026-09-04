# Livepeer DKG Iteration Lab

A working multi-project demo app for the Livepeer Agent Hackathon. Participants can define a product target, choose image, video, or video with native audio, and inspect exactly how the two DKG Knowledge Assets evolve after every Try.

The app demonstrates a simple agent loop:

1. Generate media through Livepeer Agent.
2. Judge the output against a target.
3. Store run evidence in a Run Ledger Knowledge Asset.
4. Store distilled lessons in an Improvement Memory Knowledge Asset.
5. Use that DKG memory to make the next attempt better.

Short version: one Knowledge Asset remembers the evidence; one Knowledge Asset remembers how to improve. Each project has its own timeline, artifacts, asset snapshots, and export receipt.

## Product Flow

1. Choose **New project** and define the output, media type, format, criteria, avoid rules, and target score.
2. Generate a baseline through the remote Livepeer capability.
3. Inspect the artifact and blind-judge result.
4. Compare the Run Ledger and Improvement Memory in visual, JSON-LD, RDF, and change views.
5. Run the next Try with DKG memory, or switch projects without losing history.

## Quick Start

```bash
npm install
npm run dev
```

Open `http://localhost:8080`.

The checked-in Docker configuration uses real mode: Livepeer raw MCP, a remote Livepeer-backed judge, and a local DKG edge node. For local development without remote calls or DKG, set `LIVEPEER_MODE=mock`, `JUDGE_MODE=mock`, and `DKG_MODE=file` in `.env`.

## Run With Docker

```bash
cp .env.example .env
./scripts/init-dkg-volume.sh
docker compose up --build
```

Open `http://localhost:8787`.

The init script creates a local DKG home in the `iteration-lab-dkg-home` Docker volume. The node uses DKG local / Shared Working Memory for the demo. It does not publish to Verifiable Memory unless you explicitly run a publish command later.

## Knowledge Assets

Run Ledger Knowledge Asset:

- target
- attempt number
- prompt summary
- Livepeer output reference
- evaluation rubric
- judge output
- score
- decision

Improvement Memory Knowledge Asset:

- what worked
- what failed
- what constraints should be stronger
- what style anchors should be reused
- what the next prompt should try

The app writes immutable, per-project and per-Try JSON-LD and RDF/Turtle snapshots. Receipts are also scoped per project. The UI exposes the same state through visual, JSON-LD, RDF, and before/after change views.

## Real Integrations

The Docker path is configured for real integrations.

Livepeer:

- Set `LIVEPEER_MODE=real`.
- Set `LIVEPEER_MCP_URL=https://agent.livepeer.org/api/mcp`.
- The built-in media profiles use `flux-schnell` for images, `flux-3-draft-t2v` for video, and `ltx-25-t2v-fast` for video with native audio. Each can be overridden with the corresponding runtime capability variable.
- The app calls the remote Livepeer raw MCP surface. It does not run Livepeer capabilities, models, renderers, or LiveBridge components locally.
- Keep bearer tokens in the runtime environment, never in Git.

Judge:

- Set `JUDGE_MODE=real`.
- By default, the judge calls the same remote Livepeer raw MCP endpoint with `gemini-text`.
- The judge stores a compact score, feedback sentence, and judge reference in the Run Ledger Knowledge Asset.
- It does not run a local LLM, image model, renderer, or Livepeer capability.

DKG:

- Use `DKG_MODE=cli` in Docker.
- Run `./scripts/init-dkg-volume.sh` once to initialize the local DKG home volume.
- Set `DKG_CONTEXT_GRAPH_NAME` to a short demo graph name. The app resolves or creates the full Context Graph ID.
- The CLI adapter writes an immutable, session-and-iteration-scoped Run Ledger and Improvement Memory snapshot pair to Shared Working Memory. Each later snapshot is cumulative, so the gallery can compare history without mutating an already shared assertion.
- Publish to Verifiable Memory only when finality is useful and wallet/network setup is ready.

## DKG CLI Shape

```bash
dkg context-graph create iteration-lab-demo
dkg ka create iteration-lab-run-ledger -c "$CG" --input-file ./run-ledger-ka.ttl --share
dkg query "$CG" --include-shared-memory --file ./readback.sparql
```

Publish to Verifiable Memory only when finality is useful and the wallet/network setup is ready.

## Safety Rules

Do not put these into DKG, logs, screenshots, or GitHub:

- private keys
- tokens
- auth flows
- machine names
- local paths
- private browser state
- raw private prompts
- hidden chain-of-thought
- large video bytes
- personal data

Store references, hashes, short summaries, scores, and reviewable judge outputs instead.

## Scripts

```bash
npm run dev        # start the app locally
npm run build      # build client and server
npm run start      # run the production build
npm run test       # run the improvement-loop test
npm run typecheck  # check client and server types
```
