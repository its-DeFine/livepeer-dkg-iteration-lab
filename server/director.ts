import type {
  AttemptRecord,
  ConfigStatus,
  DemoState,
  ImprovementMemoryKa,
  RunAttemptRequest,
  RunAttemptResponse,
  RunLedgerKa,
  SubmissionReceipt,
  TargetSpec
} from "../shared/types.js";
import { createDkgAdapter } from "./adapters/dkg.js";
import { createLivepeerAdapter } from "./adapters/livepeer.js";
import { JsonStateStore } from "./storage.js";

const demoContext = {
  demo: "https://atumera.example/livepeer-dkg#",
  schema: "https://schema.org/"
};

export function createDirector(dataDir: string) {
  const store = new JsonStateStore(dataDir);
  const livepeer = createLivepeerAdapter();
  const dkg = createDkgAdapter(store);

  async function getState(): Promise<DemoState> {
    const existing = await store.read();
    if (existing) {
      return existing;
    }
    const state = createInitialState(defaultTarget());
    await persist(state);
    return state;
  }

  async function reset(): Promise<DemoState> {
    const state = createInitialState(defaultTarget());
    await persist(state);
    return state;
  }

  async function runAttempt(request: RunAttemptRequest): Promise<RunAttemptResponse> {
    const current = await getState();
    const target = request.target ?? current.target;
    const attemptNumber = current.target.id === target.id ? current.attempts.length + 1 : 1;
    const memoryUsed = request.useDkgMemory ? selectMemory(current.improvementMemory) : [];
    const prompt = buildPrompt(target, memoryUsed, attemptNumber);
    const media = await livepeer.generate({ attemptNumber, prompt, target });
    const judge = judgeAttempt(attemptNumber, request.useDkgMemory, current.improvementMemory);

    const attempt: AttemptRecord = {
      id: `${target.id}-attempt-${attemptNumber}`,
      attemptNumber,
      promptSummary: summarizePrompt(prompt),
      promptPreview: prompt,
      usedDkgMemory: request.useDkgMemory,
      outputReference: media.outputReference,
      outputHash: media.outputHash,
      score: judge.score,
      pass: judge.score >= target.targetScore,
      judgeOutputSummary: judge.feedback,
      createdAt: new Date().toISOString()
    };

    const attempts = attemptNumber === 1 ? [attempt] : [...current.attempts, attempt];
    const runLedger = buildRunLedger(target, attempts);
    const improvementMemory = buildImprovementMemory(target, attempts);
    const receipt = buildReceipt(target, attempts, runLedger, improvementMemory);
    const nextState: DemoState = {
      target,
      attempts,
      runLedger,
      improvementMemory,
      receipt,
      updatedAt: new Date().toISOString()
    };

    await persist(nextState);
    return { state: nextState, attempt, memoryUsed };
  }

  async function persist(state: DemoState): Promise<void> {
    await store.write(state);
    await dkg.writeState(state);
  }

  return {
    getState,
    reset,
    runAttempt,
    getConfig
  };
}

function getConfig(): ConfigStatus {
  return {
    livepeerMode: process.env.LIVEPEER_MODE === "real" ? "real" : "mock",
    dkgMode: process.env.DKG_MODE === "cli" ? "cli" : "file",
    judgeMode: process.env.JUDGE_MODE === "real" ? "real" : "mock",
    livepeerConfigured: Boolean(process.env.LIVEPEER_MCP_URL),
    dkgConfigured: Boolean(process.env.DKG_CONTEXT_GRAPH_ID)
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
  const runLedger = buildRunLedger(target, attempts);
  const improvementMemory = buildImprovementMemory(target, attempts);
  const receipt = buildReceipt(target, attempts, runLedger, improvementMemory);
  return {
    target,
    attempts,
    runLedger,
    improvementMemory,
    receipt,
    updatedAt: new Date().toISOString()
  };
}

function selectMemory(memory: ImprovementMemoryKa): string[] {
  return [
    ...memory["demo:knownFailure"],
    ...memory["demo:successfulPattern"],
    memory["demo:nextPromptStrategy"]
  ].filter(Boolean);
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

function judgeAttempt(
  attemptNumber: number,
  usedDkgMemory: boolean,
  memory: ImprovementMemoryKa
): { score: number; feedback: string } {
  if (attemptNumber === 1 || !usedDkgMemory) {
    return {
      score: 3,
      feedback:
        "The output has a usable cinematic direction, but the product is not explicit enough and the ending frame is not yet clean."
    };
  }

  const priorScore = memory["demo:latestScore"] || 3;
  const score = Math.min(9, priorScore + 3);
  const feedback =
    score >= 8
      ? "The output now preserves the cinematic tone, makes the product clearer, and gives the final frame a stronger thumbnail shape."
      : "The output improves product visibility and tone, but the final frame still needs a clearer ending composition.";
  return { score, feedback };
}

function buildRunLedger(target: TargetSpec, attempts: AttemptRecord[]): RunLedgerKa {
  return {
    "@context": demoContext,
    "@id": `demo:run-ledger/${target.id}`,
    "@type": "demo:RunLedger",
    "demo:targetId": target.id,
    "demo:hasAttempt": attempts.map((attempt) => ({
      "@id": `demo:attempt/${target.id}/${attempt.attemptNumber}`,
      "@type": "demo:GenerationAttempt",
      "demo:attemptNumber": attempt.attemptNumber,
      "demo:promptSummary": attempt.promptSummary,
      "demo:usedDkgMemory": attempt.usedDkgMemory,
      "demo:outputReference": attempt.outputReference,
      "demo:outputHash": attempt.outputHash,
      "demo:score": attempt.score,
      "demo:pass": attempt.pass,
      "demo:judgeOutputSummary": attempt.judgeOutputSummary,
      "demo:createdAt": attempt.createdAt
    }))
  };
}

function buildImprovementMemory(target: TargetSpec, attempts: AttemptRecord[]): ImprovementMemoryKa {
  const bestAttempt = attempts.reduce<AttemptRecord | undefined>(
    (best, attempt) => (!best || attempt.score > best.score ? attempt : best),
    undefined
  );
  const latest = attempts.at(-1);

  return {
    "@context": demoContext,
    "@id": `demo:improvement-memory/${target.id}`,
    "@type": "demo:ImprovementMemory",
    "demo:targetId": target.id,
    "demo:currentBestAttempt": bestAttempt ? `demo:attempt/${target.id}/${bestAttempt.attemptNumber}` : undefined,
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
    "demo:updatedAt": new Date().toISOString()
  };
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
