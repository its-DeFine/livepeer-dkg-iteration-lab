import crypto from "node:crypto";
import type {
  AttemptRecord,
  ConfigStatus,
  CreateProjectRequest,
  DemoState,
  ImprovementMemoryKa,
  IterationSnapshot,
  MediaType,
  RunAttemptRequest,
  RunAttemptResponse,
  RunLedgerKa,
  SubmissionReceipt,
  TargetSpec,
  WorkspaceState
} from "../shared/types.js";
import {
  buildImprovementMemoryTurtle,
  buildRunLedgerTurtle,
  createDkgAdapter
} from "./adapters/dkg.js";
import { createLivepeerAdapter, mediaProfileFor, supportedMediaProfiles } from "./adapters/livepeer.js";
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

  async function getWorkspace(): Promise<WorkspaceState> {
    const existingWorkspace = await store.readWorkspace();
    if (existingWorkspace) {
      const normalized = normalizeWorkspace(existingWorkspace);
      if (JSON.stringify(normalized) !== JSON.stringify(existingWorkspace)) {
        await writeWorkspace(normalized);
      }
      return normalized;
    }

    const legacy = await store.read();
    const firstProject = legacy ? normalizeProject(legacy) : createInitialProject(defaultTarget());
    const workspace: WorkspaceState = {
      projects: [firstProject],
      activeProjectId: firstProject.projectId,
      updatedAt: new Date().toISOString()
    };
    await writeWorkspace(workspace);
    return workspace;
  }

  async function createProject(request: CreateProjectRequest): Promise<WorkspaceState> {
    const workspace = await getWorkspace();
    const target = targetFromRequest(request);
    const project = createInitialProject(target);
    const next: WorkspaceState = {
      projects: [...workspace.projects, project],
      activeProjectId: project.projectId,
      updatedAt: new Date().toISOString()
    };
    await writeWorkspace(next);
    return next;
  }

  async function selectProject(projectId: string): Promise<WorkspaceState> {
    const workspace = await getWorkspace();
    requireProject(workspace, projectId);
    const next = { ...workspace, activeProjectId: projectId, updatedAt: new Date().toISOString() };
    await writeWorkspace(next);
    return next;
  }

  async function runAttempt(request: RunAttemptRequest): Promise<RunAttemptResponse> {
    const workspace = await getWorkspace();
    const projectId = request.projectId || workspace.activeProjectId;
    const current = requireProject(workspace, projectId);
    const target = current.target;
    const attemptNumber = current.attempts.length + 1;
    const memoryUsed = request.useDkgMemory ? await dkg.readMemory(current) : [];
    const prompt = buildPrompt(target, memoryUsed, attemptNumber);
    const media = await livepeer.generate({ attemptNumber, prompt, target });
    const judgment = await judge.judge({ target, media });

    const attempt: AttemptRecord = {
      id: `${target.id}-attempt-${attemptNumber}`,
      judgeScope: "blind-artifact",
      attemptNumber,
      promptSummary: summarizePrompt(prompt),
      promptPreview: prompt,
      usedDkgMemory: request.useDkgMemory,
      mediaType: media.mediaType,
      generationCapability: media.capability,
      outputReference: media.outputReference,
      outputHash: media.outputHash,
      score: judgment.score,
      pass: judgment.score >= target.targetScore,
      judgeOutputSummary: judgment.feedback,
      judgeReference: judgment.reference,
      createdAt: new Date().toISOString()
    };

    const attempts = [...current.attempts, attempt];
    const runLedger = buildRunLedger(current.sessionId, target, attempts);
    const improvementMemory = buildImprovementMemory(current.sessionId, target, attempts, attempt.createdAt);
    const draftProject: DemoState = {
      ...current,
      attempts,
      runLedger,
      improvementMemory,
      iterationSnapshots: current.iterationSnapshots,
      receipt: buildReceipt(current.projectId, target, attempts, runLedger, improvementMemory),
      updatedAt: new Date().toISOString()
    };
    const snapshot = buildSnapshot(draftProject, attempt, "pending");
    draftProject.iterationSnapshots = [...current.iterationSnapshots, snapshot];

    let nextWorkspace = replaceProject(workspace, draftProject);
    await writeWorkspace(nextWorkspace);

    try {
      const references = await dkg.writeState(draftProject);
      snapshot.dkg = {
        state: "shared",
        layer: process.env.DKG_MODE === "cli" ? "SWM" : "local",
        runLedgerReference: references.runLedgerReference,
        improvementMemoryReference: references.improvementMemoryReference,
        recordedAt: new Date().toISOString()
      };
      draftProject.receipt.runLedgerReference = references.runLedgerReference;
      draftProject.receipt.improvementMemoryReference = references.improvementMemoryReference;
      nextWorkspace = replaceProject(nextWorkspace, draftProject);
      await writeWorkspace(nextWorkspace);
    } catch (error) {
      snapshot.dkg = { state: "failed", layer: process.env.DKG_MODE === "cli" ? "WM" : "local" };
      nextWorkspace = replaceProject(nextWorkspace, draftProject);
      await writeWorkspace(nextWorkspace);
      throw error;
    }

    return { workspace: nextWorkspace, state: draftProject, attempt, memoryUsed };
  }

  async function backfillProject(projectId: string): Promise<WorkspaceState> {
    let workspace = await getWorkspace();
    const project = requireProject(workspace, projectId);

    for (let index = 0; index < project.iterationSnapshots.length; index += 1) {
      const snapshot = project.iterationSnapshots[index];
      if (snapshot.dkg.state === "shared") continue;
      const attempts = project.attempts.slice(0, index + 1);
      const partial: DemoState = {
        ...project,
        attempts,
        runLedger: snapshot.runLedger,
        improvementMemory: snapshot.improvementMemory,
        iterationSnapshots: project.iterationSnapshots.slice(0, index + 1),
        receipt: buildReceipt(project.projectId, project.target, attempts, snapshot.runLedger, snapshot.improvementMemory),
        updatedAt: snapshot.capturedAt
      };
      try {
        const references = await dkg.writeState(partial);
        snapshot.dkg = {
          state: "shared",
          layer: process.env.DKG_MODE === "cli" ? "SWM" : "local",
          runLedgerReference: references.runLedgerReference,
          improvementMemoryReference: references.improvementMemoryReference,
          recordedAt: new Date().toISOString()
        };
        if (index === project.iterationSnapshots.length - 1) {
          project.receipt.runLedgerReference = references.runLedgerReference;
          project.receipt.improvementMemoryReference = references.improvementMemoryReference;
        }
      } catch {
        snapshot.dkg = { state: "failed", layer: process.env.DKG_MODE === "cli" ? "WM" : "local" };
      }
      workspace = replaceProject(workspace, project);
      await writeWorkspace(workspace);
    }
    return workspace;
  }

  async function writeWorkspace(workspace: WorkspaceState): Promise<void> {
    await store.writeWorkspace(workspace);
    for (const project of workspace.projects) {
      await store.writeJson(`receipts/${project.projectId}.json`, project.receipt);
    }
  }

  return {
    getWorkspace,
    getState: getWorkspace,
    createProject,
    selectProject,
    runAttempt,
    backfillProject,
    getConfig
  };
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
    judgeConfigured,
    mediaProfiles: supportedMediaProfiles()
  };
}

function defaultTarget(): TargetSpec {
  return {
    id: "signal-brew-launch",
    title: "Signal Brew Launch",
    brief:
      "Create a cinematic launch artifact for a fictional product called Signal Brew. It should feel precise and optimistic, keep the product visible, and finish with a clean composition.",
    mediaType: "image",
    aspectRatio: "16:9",
    successCriteria: [
      "The product is visible in the opening or final composition.",
      "The tone feels optimistic and cinematic.",
      "The output avoids dark dystopian visuals.",
      "The final composition is clean enough to use as a thumbnail."
    ],
    avoid: ["real customer data", "dystopian language", "unreadable text", "private brands"],
    targetScore: 8
  };
}

function targetFromRequest(request: CreateProjectRequest): TargetSpec {
  const title = cleanRequired(request.title, "Project name", 100);
  const brief = cleanRequired(request.brief, "Desired output", 1200);
  const mediaType: MediaType = ["image", "video", "video-audio"].includes(request.mediaType)
    ? request.mediaType
    : "image";
  const durationSeconds = mediaType === "image"
    ? undefined
    : Math.max(mediaType === "video-audio" ? 6 : 1, Math.min(20, Number(request.durationSeconds ?? 6)));
  const successCriteria = cleanList(request.successCriteria, 8, 240);
  const avoid = cleanList(request.avoid, 8, 160);
  if (!successCriteria.length) throw new Error("Add at least one success criterion.");

  return {
    id: `${slug(title)}-${crypto.randomUUID().slice(0, 6)}`,
    title,
    brief,
    mediaType,
    durationSeconds,
    aspectRatio: ["1:1", "16:9", "9:16"].includes(request.aspectRatio) ? request.aspectRatio : "16:9",
    successCriteria,
    avoid,
    targetScore: Math.max(1, Math.min(10, Math.round(Number(request.targetScore || 8))))
  };
}

function cleanRequired(value: unknown, label: string, max: number): string {
  const cleaned = typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
  if (!cleaned) throw new Error(`${label} is required.`);
  return cleaned;
}

function cleanList(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.replace(/\s+/g, " ").trim().slice(0, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function createSessionId(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `session-${date}-${crypto.randomUUID().slice(0, 8)}`;
}

function createInitialProject(target: TargetSpec): DemoState {
  const now = new Date().toISOString();
  const sessionId = createSessionId();
  const projectId = `project-${crypto.randomUUID().slice(0, 8)}`;
  const runLedger = buildRunLedger(sessionId, target, []);
  const improvementMemory = buildImprovementMemory(sessionId, target, []);
  return {
    projectId,
    sessionId,
    createdAt: now,
    target,
    attempts: [],
    runLedger,
    improvementMemory,
    iterationSnapshots: [],
    receipt: buildReceipt(projectId, target, [], runLedger, improvementMemory),
    updatedAt: now
  };
}

function normalizeWorkspace(workspace: WorkspaceState): WorkspaceState {
  const projects = workspace.projects.map(normalizeProject);
  const activeProjectId = projects.some((project) => project.projectId === workspace.activeProjectId)
    ? workspace.activeProjectId
    : projects[0]?.projectId ?? "";
  return { ...workspace, projects, activeProjectId };
}

function normalizeProject(input: Partial<DemoState> & Pick<DemoState, "target" | "attempts">): DemoState {
  const sessionId = input.sessionId || createSessionId();
  const projectId = input.projectId || `project-${crypto.randomUUID().slice(0, 8)}`;
  const createdAt = input.createdAt || input.attempts[0]?.createdAt || new Date().toISOString();
  const target: TargetSpec = {
    ...input.target,
    mediaType: input.target.mediaType || inferMediaType(input.attempts[0]?.outputReference),
    aspectRatio: input.target.aspectRatio || "16:9"
  };
  const attempts = input.attempts.map((attempt) => ({
    ...attempt,
    mediaType: attempt.mediaType || target.mediaType,
    generationCapability: attempt.generationCapability || mediaProfileFor(target.mediaType).capability,
    judgeScope: attempt.judgeScope || "blind-artifact"
  }));
  const runLedger = buildRunLedger(sessionId, target, attempts);
  const improvementMemory = input.improvementMemory || buildImprovementMemory(sessionId, target, attempts);
  const sourceSnapshots = Array.isArray(input.iterationSnapshots) && input.iterationSnapshots.length
    ? input.iterationSnapshots
    : buildIterationSnapshots({ projectId, sessionId, createdAt, target, attempts, runLedger, improvementMemory } as DemoState);
  const iterationSnapshots = sourceSnapshots.map((snapshot, index) => {
    const partialAttempts = attempts.slice(0, index + 1);
    const snapshotState = {
      projectId,
      sessionId,
      createdAt,
      target,
      attempts: partialAttempts,
      runLedger: snapshot.runLedger || buildRunLedger(sessionId, target, partialAttempts),
      improvementMemory:
        snapshot.improvementMemory || buildImprovementMemory(sessionId, target, partialAttempts, snapshot.capturedAt),
      iterationSnapshots: [],
      receipt: {} as SubmissionReceipt,
      updatedAt: snapshot.capturedAt
    } as DemoState;
    const isLatest = index === sourceSnapshots.length - 1;
    const legacyShared = isLatest && input.receipt?.runLedgerReference?.startsWith("dkg:");
    return {
      ...snapshot,
      runLedgerRdf: snapshot.runLedgerRdf || buildRunLedgerTurtle(snapshotState),
      improvementMemoryRdf: snapshot.improvementMemoryRdf || buildImprovementMemoryTurtle(snapshotState),
      dkg: snapshot.dkg || (legacyShared
        ? {
            state: "shared" as const,
            layer: "SWM" as const,
            runLedgerReference: input.receipt?.runLedgerReference,
            improvementMemoryReference: input.receipt?.improvementMemoryReference,
            recordedAt: snapshot.capturedAt
          }
        : { state: "recorded" as const, layer: "local" as const })
    };
  });
  const receipt = buildReceipt(projectId, target, attempts, runLedger, improvementMemory);
  if (input.receipt?.exportedAt) receipt.exportedAt = input.receipt.exportedAt;
  if (input.receipt?.runLedgerReference) receipt.runLedgerReference = input.receipt.runLedgerReference;
  if (input.receipt?.improvementMemoryReference) {
    receipt.improvementMemoryReference = input.receipt.improvementMemoryReference;
  }
  return {
    projectId,
    sessionId,
    createdAt,
    target,
    attempts,
    runLedger,
    improvementMemory,
    iterationSnapshots,
    receipt,
    updatedAt: input.updatedAt || new Date().toISOString()
  };
}

function inferMediaType(reference?: string): MediaType {
  return reference && /\.(?:mp4|webm|mov|m4v)(?:\?|$)/i.test(reference) ? "video" : "image";
}

function requireProject(workspace: WorkspaceState, projectId: string): DemoState {
  const project = workspace.projects.find((candidate) => candidate.projectId === projectId);
  if (!project) throw new Error("Project not found.");
  return project;
}

function replaceProject(workspace: WorkspaceState, project: DemoState): WorkspaceState {
  return {
    projects: workspace.projects.map((candidate) => candidate.projectId === project.projectId ? project : candidate),
    activeProjectId: project.projectId,
    updatedAt: new Date().toISOString()
  };
}

function buildPrompt(target: TargetSpec, memoryUsed: string[], attemptNumber: number): string {
  const memoryBlock = memoryUsed.length
    ? `Use these DKG improvement notes: ${memoryUsed.join(" ")}`
    : "No prior DKG improvement memory is available. Make a first attempt from the target only.";
  const mediaInstruction = target.mediaType === "image"
    ? `Create a ${target.aspectRatio} image.`
    : `Create a ${target.durationSeconds ?? 6}-second ${target.aspectRatio} ${target.mediaType === "video-audio" ? "video with native audio" : "video"}.`;

  return [
    `Attempt ${attemptNumber}: ${target.brief}`,
    mediaInstruction,
    `Success criteria: ${target.successCriteria.join(" ")}`,
    `Avoid: ${target.avoid.join(", ")}.`,
    memoryBlock,
    "Return a media output that can be judged against the visible criteria."
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
      "demo:mediaType": attempt.mediaType,
      "demo:generationCapability": attempt.generationCapability,
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
  const successful = attempts
    .filter((attempt) => attempt.score >= target.targetScore)
    .slice(-3)
    .map((attempt) => attempt.judgeOutputSummary);
  return {
    "@context": demoContext,
    "@id": `demo:improvement-memory/${sessionId}/${target.id}`,
    "@type": "demo:ImprovementMemory",
    "demo:targetId": target.id,
    "demo:sessionId": sessionId,
    "demo:currentBestAttempt": bestAttempt
      ? `demo:attempt/${sessionId}/${target.id}/${bestAttempt.attemptNumber}`
      : undefined,
    "demo:knownFailure": latest && latest.score < target.targetScore ? [latest.judgeOutputSummary] : [],
    "demo:successfulPattern": successful,
    "demo:nextPromptStrategy": latest
      ? `Improve the next prompt using this blind-judge observation: ${latest.judgeOutputSummary}`
      : "Run the first attempt from the target brief, then judge it before creating improvement memory.",
    "demo:latestScore": latest?.score ?? 0,
    "demo:updatedAt": updatedAt
  };
}

function buildSnapshot(project: DemoState, attempt: AttemptRecord, state: "pending" | "recorded"): IterationSnapshot {
  return {
    attemptNumber: attempt.attemptNumber,
    attemptId: attempt.id,
    artifactReference: attempt.outputReference,
    artifactHash: attempt.outputHash,
    runLedger: project.runLedger,
    improvementMemory: project.improvementMemory,
    runLedgerRdf: buildRunLedgerTurtle(project),
    improvementMemoryRdf: buildImprovementMemoryTurtle(project),
    dkg: { state, layer: state === "pending" ? "WM" : "local" },
    capturedAt: attempt.createdAt
  };
}

function buildIterationSnapshots(project: DemoState): IterationSnapshot[] {
  return project.attempts.map((attempt, index) => {
    const attempts = project.attempts.slice(0, index + 1);
    const partial = {
      ...project,
      attempts,
      runLedger: buildRunLedger(project.sessionId, project.target, attempts),
      improvementMemory: buildImprovementMemory(project.sessionId, project.target, attempts, attempt.createdAt)
    };
    return buildSnapshot(partial, attempt, "recorded");
  });
}

function buildReceipt(
  projectId: string,
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
    projectId,
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

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "project";
}
