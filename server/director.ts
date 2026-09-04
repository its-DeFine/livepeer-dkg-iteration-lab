import crypto from "node:crypto";
import type {
  AttemptRecord,
  ConfigStatus,
  DemoState,
  ImprovementMemoryKa,
  IterationSnapshot,
  RunAttemptRequest,
  RunAttemptResponse,
  RunLedgerKa,
  SubmissionReceipt,
  TargetSpec
} from "../shared/types.js";
import { createDkgAdapter } from "./adapters/dkg.js";
import { createLivepeerAdapter } from "./adapters/livepeer.js";
import { createJudgeAdapter } from "./adapters/judge.js";
import { JsonStateStore } from "./storage.js";

const demoContext = {
  demo: "https://atumera.example/livepeer-dkg#",
  schema: "https://schema.org/"
};

export function createDirector(dataDir: string) {
  const store = new JsonStateStore(dataDir);
  const livepeer = createLivepeerAdapter();
  const dkg = createDkgAdapter(store);
  const judge = createJudgeAdapter();

  async function getState(): Promise<DemoState> {
    const existing = await store.read();
    if (existing) {
      const sessionId = existing.sessionId || createSessionId();
      if (!existing.sessionId || !Array.isArray(existing.iterationSnapshots)) {
        const migrated: DemoState = {
          ...existing,
          sessionId,
          iterationSnapshots: buildIterationSnapshots(sessionId, existing.target, existing.attempts)
        };
        await writeLocalState(migrated);
        return migrated;
      }
      return existing;
    }
    const state = createInitialState(defaultTarget());
    await writeLocalState(state);
    return state;
  }

  async function reset(): Promise<DemoState> {
    const state = createInitialState(defaultTarget());
    await writeLocalState(state);
    return state;
  }

  async function runAttempt(request: RunAttemptRequest): Promise<RunAttemptResponse> {
    const current = await getState();
    const target = request.target ?? current.target;
    const attemptNumber = current.target.id === target.id ? current.attempts.length + 1 : 1;
    const memoryUsed = request.useDkgMemory ? await dkg.readMemory(current) : [];
    const prompt = buildPrompt(target, memoryUsed, attemptNumber);
    const media = await livepeer.generate({ attemptNumber, prompt, target });
    const judgment = await judge.judge({
      target,
      media
    });

    const attempt: AttemptRecord = {
      id: `${target.id}-attempt-${attemptNumber}`,
      judgeScope: "blind-artifact",
      attemptNumber,
      promptSummary: summarizePrompt(prompt),
      promptPreview: prompt,
      usedDkgMemory: request.useDkgMemory,
      outputReference: media.outputReference,
      outputHash: media.outputHash,
      score: judgment.score,
      pass: judgment.score >= target.targetScore,
      judgeOutputSummary: judgment.feedback,
      judgeReference: judgment.reference,
      createdAt: new Date().toISOString()
    };

    const attempts = attemptNumber === 1 ? [attempt] : [...current.attempts, attempt];
    const runLedger = buildRunLedger(current.sessionId, target, attempts);
    const improvementMemory = buildImprovementMemory(current.sessionId, target, attempts, attempt.createdAt);
    const iterationSnapshot: IterationSnapshot = {
      attemptNumber,
      attemptId: attempt.id,
      artifactReference: attempt.outputReference,
      artifactHash: attempt.outputHash,
      runLedger,
      improvementMemory,
      capturedAt: attempt.createdAt
    };
    const iterationSnapshots =
      attemptNumber === 1 ? [iterationSnapshot] : [...current.iterationSnapshots, iterationSnapshot];
    const receipt = buildReceipt(target, attempts, runLedger, improvementMemory);
    const nextState: DemoState = {
      sessionId: current.sessionId,
      target,
      attempts,
      runLedger,
      improvementMemory,
      iterationSnapshots,
      receipt,
      updatedAt: new Date().toISOString()
    };

    await persist(nextState);
    return { state: nextState, attempt, memoryUsed };
  }

  async function writeLocalState(state: DemoState): Promise<void> {
    await store.write(state);
    await store.writeJson("submission-receipt.json", state.receipt);
  }

  async function persist(state: DemoState): Promise<void> {
    const references = await dkg.writeState(state);
    state.receipt.runLedgerReference = references.runLedgerReference;
    state.receipt.improvementMemoryReference = references.improvementMemoryReference;
    await writeLocalState(state);
  }

  return {
    getState,
    reset,
    runAttempt,
    getConfig
  };
}

function createSessionId(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `session-${date}-${crypto.randomUUID().slice(0, 8)}`;
}

function getConfig(): ConfigStatus {
  const livepeerConfigured = process.env.LIVEPEER_MODE === "real" ? Boolean(process.env.LIVEPEER_MCP_URL) : true;
  const judgeConfigured =
    process.env.JUDGE_MODE === "real" ? Boolean(process.env.JUDGE_LIVEPEER_MCP_URL || process.env.LIVEPEER_MCP_URL) : true;

  return {
    livepeerMode: process.env.LIVEPEER_MODE === "real" ? "real" : "mock",
    dkgMode: process.env.DKG_MODE === "cli" ? "cli" : "file",
    judgeMode: process.env.JUDGE_MODE === "real" ? "real" : "mock",
    livepeerConfigured,
    dkgConfigured:
      process.env.DKG_MODE === "cli" ? Boolean(process.env.DKG_CONTEXT_GRAPH_ID || process.env.DKG_CONTEXT_GRAPH_NAME) : true,
    judgeConfigured
  };
}

function defaultTarget(): TargetSpec {
  return {
    id: "signal-brew-launch",
    title: "Signal Brew Launch Video",
    brief:
      "Create a 10-second launch video for a fictional product called Signal Brew. It should feel precise, optimistic, and cinematic. The product should be visible and the ending frame should feel clean.",
    successCriteria: [
      "The product is visible in the opening or final frame.",
      "The tone feels optimistic and cinematic.",
      "The output avoids dark dystopian visuals.",
      "The final frame is clean enough to use as a thumbnail."
    ],
    avoid: ["real customer data", "dystopian language", "unreadable text", "private brands"],
    targetScore: 8
  };
}

function createInitialState(target: TargetSpec): DemoState {
  const attempts: AttemptRecord[] = [];
  const sessionId = createSessionId();
  const runLedger = buildRunLedger(sessionId, target, attempts);
  const improvementMemory = buildImprovementMemory(sessionId, target, attempts);
  const receipt = buildReceipt(target, attempts, runLedger, improvementMemory);
  return {
    sessionId,
    target,
    attempts,
    runLedger,
    improvementMemory,
    iterationSnapshots: [],
    receipt,
    updatedAt: new Date().toISOString()
  };
}

function buildPrompt(target: TargetSpec, memoryUsed: string[], attemptNumber: number): string {
  const memoryBlock = memoryUsed.length
    ? `Use these DKG improvement notes: ${memoryUsed.join(" ")}`
    : "No prior DKG improvement memory is available. Make a first attempt from the target only.";

  return [
    `Attempt ${attemptNumber}: ${target.brief}`,
    `Success criteria: ${target.successCriteria.join(" ")}`,
    `Avoid: ${target.avoid.join(", ")}.`,
    memoryBlock,
    "Return a short media output that can be judged against the criteria."
  ].join("\n");
}

function summarizePrompt(prompt: string): string {
  return prompt.replace(/\s+/g, " ").slice(0, 180);
}

function buildRunLedger(sessionId: string, target: TargetSpec, attempts: AttemptRecord[]): RunLedgerKa {
  return {
    "@context": demoContext,
    "@id": `demo:run-ledger/${sessionId}/${target.id}`,
    "@type": "demo:RunLedger",
    "demo:targetId": target.id,
    "demo:sessionId": sessionId,
    "demo:hasAttempt": attempts.map((attempt) => ({
      "@id": `demo:attempt/${sessionId}/${target.id}/${attempt.attemptNumber}`,
      "@type": "demo:GenerationAttempt",
      "demo:attemptNumber": attempt.attemptNumber,
      "demo:promptSummary": attempt.promptSummary,
      "demo:usedDkgMemory": attempt.usedDkgMemory,
      "demo:outputReference": attempt.outputReference,
      "demo:outputHash": attempt.outputHash,
      "demo:score": attempt.score,
      "demo:pass": attempt.pass,
      "demo:judgeOutputSummary": attempt.judgeOutputSummary,
      "demo:judgeReference": attempt.judgeReference,
      "demo:judgeScope": attempt.judgeScope,
      "demo:createdAt": attempt.createdAt
    }))
  };
}

function buildImprovementMemory(
  sessionId: string,
  target: TargetSpec,
  attempts: AttemptRecord[],
  updatedAt = new Date().toISOString()
): ImprovementMemoryKa {
  const bestAttempt = attempts.reduce<AttemptRecord | undefined>(
    (best, attempt) => (!best || attempt.score > best.score ? attempt : best),
    undefined
  );
  const latest = attempts.at(-1);

  return {
    "@context": demoContext,
    "@id": `demo:improvement-memory/${sessionId}/${target.id}`,
    "@type": "demo:ImprovementMemory",
    "demo:targetId": target.id,
    "demo:sessionId": sessionId,
    "demo:currentBestAttempt": bestAttempt ? `demo:attempt/${sessionId}/${target.id}/${bestAttempt.attemptNumber}` : undefined,
    "demo:knownFailure": latest?.score && latest.score < target.targetScore
      ? ["Product visibility needs to be explicit.", "The ending frame needs a cleaner composition."]
      : [],
    "demo:successfulPattern": latest
      ? ["Cinematic lighting fits the target tone.", "Short focused prompts are easier to judge."]
      : [],
    "demo:nextPromptStrategy": latest
      ? "Make the product visible in the first and final frames, keep the cinematic tone, and ask for a clean final composition."
      : "Run the first attempt from the target brief, then judge it before creating improvement memory.",
    "demo:latestScore": latest?.score ?? 0,
    "demo:updatedAt": updatedAt
  };
}

function buildIterationSnapshots(
  sessionId: string,
  target: TargetSpec,
  attempts: AttemptRecord[]
): IterationSnapshot[] {
  return attempts.map((attempt, index) => {
    const attemptsAtIteration = attempts.slice(0, index + 1);
    return {
      attemptNumber: attempt.attemptNumber,
      attemptId: attempt.id,
      artifactReference: attempt.outputReference,
      artifactHash: attempt.outputHash,
      runLedger: buildRunLedger(sessionId, target, attemptsAtIteration),
      improvementMemory: buildImprovementMemory(sessionId, target, attemptsAtIteration, attempt.createdAt),
      capturedAt: attempt.createdAt
    };
  });
}

function buildReceipt(
  target: TargetSpec,
  attempts: AttemptRecord[],
  runLedger: RunLedgerKa,
  improvementMemory: ImprovementMemoryKa
): SubmissionReceipt {
  const best = attempts.reduce<AttemptRecord | undefined>(
    (candidate, attempt) => (!candidate || attempt.score > candidate.score ? attempt : candidate),
    undefined
  );

  return {
    targetId: target.id,
    exportedAt: new Date().toISOString(),
    bestAttemptId: best?.id,
    bestScore: best?.score ?? 0,
    attemptCount: attempts.length,
    outputReferences: attempts.map((attempt) => attempt.outputReference),
    runLedgerReference: runLedger["@id"],
    improvementMemoryReference: improvementMemory["@id"],
    safetyNote:
      "This receipt stores references, summaries, scores, and reviewable evaluation output. It does not include secrets, private keys, local paths, or raw private media."
  };
}
