# Livepeer DKG Iteration Lab

A starter app for the Livepeer Agent Hackathon.

The app demonstrates a simple agent loop:

1. Generate media through Livepeer Agent.
2. Judge the output against a target.
3. Store run evidence in a Run Ledger Knowledge Asset.
4. Store distilled lessons in an Improvement Memory Knowledge Asset.
5. Use that DKG memory to make the next attempt better.

Short version: one Knowledge Asset remembers the evidence; one Knowledge Asset remembers how to improve.

## Quick Start

```bash
npm install
npm run dev
```

Open `http://localhost:8080`.

The default mode is mock mode. It does not need Livepeer credentials, DKG credentials, private keys, or a running DKG node.

## Run With Docker

```bash
cp .env.example .env
docker compose up --build
```

Open `http://localhost:8787`.

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

The mock DKG adapter writes JSON-LD files into the app data directory:

- `run-ledger-ka.jsonld`
- `improvement-memory-ka.jsonld`
- `submission-receipt.json`

## Real Integrations

Mock mode is the reliable onboarding path. Real integrations are intentionally behind explicit configuration.

Livepeer:

- Set `LIVEPEER_MODE=real`.
- Set `LIVEPEER_MCP_URL`.
- Optionally set `LIVEPEER_MCP_TOOL`.
- Keep bearer tokens in the runtime environment, never in Git.

DKG:

- Use `DKG_MODE=file` for the starter flow.
- Use the exported JSON-LD files as payloads for DKG Knowledge Asset operations.
- For a real DKG CLI flow, create a Context Graph, write the JSON-LD/RDF payloads as Knowledge Assets, share to Shared Working Memory, and optionally publish a final receipt to Verifiable Memory on testnet.

## DKG CLI Shape

```bash
dkg context-graph create livepeer-dkg-iteration-lab
dkg ka create run-ledger -c "$CG" --input-file ./run-ledger-ka.jsonld --share
dkg ka create improvement-memory -c "$CG" --input-file ./improvement-memory-ka.jsonld --share
dkg ka query run-ledger -c "$CG"
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
