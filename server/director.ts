import crypto from "node:crypto";
import type {
  AttemptJob,
  AttemptRecord,
  ConfigStatus,
  CreateProjectRequest,
  DemoState,
  ImprovementMemoryKa,
  KnowledgeObservation,
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
  createDkgAdapter,
  sanitizeDkgMemoryText
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
  let mutationTail = Promise.resolve();

  async function loadWorkspace(): Promise<WorkspaceState> {
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

  async function getWorkspace(): Promise<WorkspaceState> {
    await mutationTail;
    return loadWorkspace();
  }

  async function mutateWorkspace<T>(
    mutate: (workspace: WorkspaceState) =>
      { workspace: WorkspaceState; value: T } | Promise<{ workspace: WorkspaceState; value: T }>
  ): Promise<T> {
    const previous = mutationTail;
    let release = () => {};
    mutationTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      const result = await mutate(await loadWorkspace());
      await writeWorkspace(result.workspace);
      return result.value;
    } finally {
      release();
    }
  }

  async function createProject(request: CreateProjectRequest): Promise<WorkspaceState> {
    return mutateWorkspace((workspace) => {
      const target = targetFromRequest(request);
      const project = createInitialProject(target);
      const next: WorkspaceState = {
        projects: [...workspace.projects, project],
        activeProjectId: project.projectId,
        updatedAt: new Date().toISOString()
      };
      return { workspace: next, value: next };
    });
  }

  async function selectProject(projectId: string): Promise<WorkspaceState> {
    return mutateWorkspace((workspace) => {
      requireProject(workspace, projectId);
      const next = { ...workspace, activeProjectId: projectId, updatedAt: new Date().toISOString() };
      return { workspace: next, value: next };
    });
  }

  async function updateAttemptJob(
    projectId: string,
    jobId: string,
    patch: Partial<AttemptJob>
  ): Promise<DemoState> {
    return mutateWorkspace((workspace) => {
      const project = requireProject(workspace, projectId);
      const now = new Date().toISOString();
      const attemptJobs = project.attemptJobs.map((job) =>
        job.id === jobId ? { ...job, ...patch, updatedAt: now } : job
      );
      if (!attemptJobs.some((job) => job.id === jobId)) throw new Error("Attempt job not found.");
      const updated = { ...project, attemptJobs, updatedAt: now };
      const next = replaceProject(workspace, updated);
      return { workspace: next, value: updated };
    });
  }

  async function failAttemptJob(
    projectId: string,
    jobId: string,
    phase: AttemptJob["phase"]
  ): Promise<void> {
    const now = new Date().toISOString();
    await updateAttemptJob(projectId, jobId, {
      status: "failed",
      phase,
      error: safeJobError(phase),
      completedAt: now
    });
  }

  async function runAttempt(request: RunAttemptRequest): Promise<RunAttemptResponse> {
    const userDirection = cleanOptional(request.userDirection, 1200);
    const reservation = await mutateWorkspace((workspace) => {
      const projectId = request.projectId || workspace.activeProjectId;
      const current = requireProject(workspace, projectId);
      if (current.attemptJobs.some((job) => isActiveJob(job))) {
        throw new Error("An attempt is already running for this project.");
      }
      const attemptNumber = Math.max(
        0,
        ...current.attempts.map((attempt) => attempt.attemptNumber),
        ...current.attemptJobs.filter(isActiveJob).map((job) => job.attemptNumber)
      ) + 1;
      const now = new Date().toISOString();
      const job: AttemptJob = {
        id: `job-${crypto.randomUUID()}`,
        projectId,
        attemptNumber,
        useDkgMemory: request.useDkgMemory,
        status: "generating",
        phase: request.useDkgMemory ? "memory" : "generation",
        startedAt: now,
        updatedAt: now
      };
      const updated = {
        ...current,
        attemptJobs: [...current.attemptJobs, job],
        updatedAt: now
      };
      const next = replaceProject(workspace, updated);
      return { workspace: next, value: { job, project: updated } };
    });

    const { job } = reservation;
    const target = reservation.project.target;
    let phase: AttemptJob["phase"] = job.phase;
    let artifactPersisted = false;
    try {
      const memoryUsed = request.useDkgMemory
        ? (await dkg.readMemory(reservation.project)).map(sanitizeDkgMemoryText).filter(Boolean)
        : [];
      phase = "generation";
      await updateAttemptJob(job.projectId, job.id, { status: "generating", phase });
      const prompt = buildPrompt(target, memoryUsed, job.attemptNumber, userDirection);
      const media = await livepeer.generate({ attemptNumber: job.attemptNumber, executionId: job.id, prompt, target });

      phase = "judging";
      await updateAttemptJob(job.projectId, job.id, { status: "judging", phase });
      const judgment = await judge.judge({ target, media });
      const createdAt = new Date().toISOString();
      const attempt: AttemptRecord = {
        id: `${target.id}-attempt-${job.attemptNumber}`,
        judgeScope: "blind-artifact",
        attemptNumber: job.attemptNumber,
        promptSummary: describePrompt(target, memoryUsed, job.attemptNumber),
        promptHash: hashValue(prompt),
        promptText: prompt,
        promptTextVerified: true,
        userDirectionApplied: Boolean(userDirection),
        memoryUsed,
        usedDkgMemory: request.useDkgMemory && memoryUsed.length > 0,
        knowledgeObservations: judgment.observations
          .map((observation) => ({ ...observation, body: sanitizeDkgMemoryText(observation.body) }))
          .filter((observation) => Boolean(observation.body)),
        nextPromptStrategy: sanitizeDkgMemoryText(judgment.nextPromptStrategy),
        mediaType: media.mediaType,
        generationCapability: media.capability,
        outputReference: media.outputReference,
        outputHash: media.outputHash,
        score: judgment.score,
        pass: judgment.score >= target.targetScore,
        judgeOutputSummary: sanitizeDkgMemoryText(judgment.feedback),
        judgeReference: judgment.reference,
        createdAt
      };

      phase = "dkg";
      const draftProject = await mutateWorkspace((workspace) => {
        const current = requireProject(workspace, job.projectId);
        if (current.attempts.some((candidate) => candidate.attemptNumber === attempt.attemptNumber)) {
          throw new Error("This attempt number is already recorded.");
        }
        const attempts = [...current.attempts, attempt].sort((left, right) => left.attemptNumber - right.attemptNumber);
        const runLedger = buildRunLedger(current.sessionId, current.target, attempts);
        const improvementMemory = buildImprovementMemory(current.sessionId, current.target, attempts, attempt.createdAt);
        const now = new Date().toISOString();
        const draft: DemoState = {
          ...current,
          attempts,
          attemptJobs: current.attemptJobs.map((candidate) =>
            candidate.id === job.id
              ? { ...candidate, status: "sharing", phase: "dkg", updatedAt: now }
              : candidate
          ),
          runLedger,
          improvementMemory,
          iterationSnapshots: current.iterationSnapshots,
          receipt: buildReceipt(current.projectId, current.target, attempts, runLedger, improvementMemory),
          updatedAt: now
        };
        draft.iterationSnapshots = [...current.iterationSnapshots, buildSnapshot(draft, attempt, "pending")];
        const next = replaceProject(workspace, draft);
        return { workspace: next, value: draft };
      });
      artifactPersisted = true;

      try {
        const references = await dkg.writeState(draftProject);
        const completed = await mutateWorkspace((workspace) => {
          const current = requireProject(workspace, job.projectId);
          const now = new Date().toISOString();
          const iterationSnapshots = current.iterationSnapshots.map((snapshot) =>
            snapshot.attemptNumber === attempt.attemptNumber
              ? {
                  ...snapshot,
                  dkg: {
                    state: "shared" as const,
                    layer: process.env.DKG_MODE === "cli" ? "SWM" as const : "local" as const,
                    runLedgerReference: references.runLedgerReference,
                    improvementMemoryReference: references.improvementMemoryReference,
                    recordedAt: now
                  }
                }
              : snapshot
          );
          const receipt = {
            ...current.receipt,
            runLedgerReference: references.runLedgerReference,
            improvementMemoryReference: references.improvementMemoryReference
          };
          const updated: DemoState = {
            ...current,
            attemptJobs: current.attemptJobs.map((candidate) =>
              candidate.id === job.id
                ? { ...candidate, status: "completed", phase: "complete", updatedAt: now, completedAt: now }
                : candidate
            ),
            iterationSnapshots,
            receipt,
            updatedAt: now
          };
          const next = replaceProject(workspace, updated);
          return { workspace: next, value: { workspace: next, state: updated } };
        });
        return { ...completed, attempt, memoryUsed };
      } catch (error) {
        await mutateWorkspace((workspace) => {
          const current = requireProject(workspace, job.projectId);
          const now = new Date().toISOString();
          const updated: DemoState = {
            ...current,
            attemptJobs: current.attemptJobs.map((candidate) =>
              candidate.id === job.id
                ? {
                    ...candidate,
                    status: "failed",
                    phase: "dkg",
                    error: safeJobError("dkg"),
                    updatedAt: now,
                    completedAt: now
                  }
                : candidate
            ),
            iterationSnapshots: current.iterationSnapshots.map((snapshot) =>
              snapshot.attemptNumber === attempt.attemptNumber
                ? { ...snapshot, dkg: { state: "failed", layer: process.env.DKG_MODE === "cli" ? "WM" : "local" } }
                : snapshot
            ),
            updatedAt: now
          };
          const next = replaceProject(workspace, updated);
          return { workspace: next, value: undefined };
        });
        throw error;
      }
    } catch (error) {
      if (!artifactPersisted) await failAttemptJob(job.projectId, job.id, phase);
      throw error;
    }
  }

  async function backfillProject(projectId: string): Promise<WorkspaceState> {
    const initial = requireProject(await getWorkspace(), projectId);
    for (let index = 0; index < initial.iterationSnapshots.length; index += 1) {
      const current = requireProject(await getWorkspace(), projectId);
      const snapshot = current.iterationSnapshots[index];
      if (snapshot.dkg.state === "shared") continue;
      const attempts = current.attempts.slice(0, index + 1);
      const partial: DemoState = {
        ...current,
        attempts,
        runLedger: snapshot.runLedger,
        improvementMemory: snapshot.improvementMemory,
        iterationSnapshots: current.iterationSnapshots.slice(0, index + 1),
        receipt: buildReceipt(current.projectId, current.target, attempts, snapshot.runLedger, snapshot.improvementMemory),
        updatedAt: snapshot.capturedAt
      };
      let dkgStatus: IterationSnapshot["dkg"] = { state: "failed", layer: process.env.DKG_MODE === "cli" ? "WM" : "local" };
      let references: { runLedgerReference: string; improvementMemoryReference: string } | undefined;
      try {
        references = await dkg.writeState(partial);
        dkgStatus = {
          state: "shared",
          layer: process.env.DKG_MODE === "cli" ? "SWM" as const : "local" as const,
          runLedgerReference: references.runLedgerReference,
          improvementMemoryReference: references.improvementMemoryReference,
          recordedAt: new Date().toISOString()
        };
      } catch {
        // The failed status is persisted below without replacing unrelated workspace changes.
      }
      await mutateWorkspace((workspace) => {
        const latest = requireProject(workspace, projectId);
        const iterationSnapshots = latest.iterationSnapshots.map((item, snapshotIndex) =>
          snapshotIndex === index ? { ...item, dkg: dkgStatus } : item
        );
        const receipt = references && index === latest.iterationSnapshots.length - 1
          ? {
              ...latest.receipt,
              runLedgerReference: references.runLedgerReference,
              improvementMemoryReference: references.improvementMemoryReference
            }
          : latest.receipt;
        const updated = { ...latest, iterationSnapshots, receipt, updatedAt: new Date().toISOString() };
        const next = replaceProject(workspace, updated);
        return { workspace: next, value: undefined };
      });
    }
    return getWorkspace();
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
    id: `target-${crypto.randomUUID()}`,
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
function cleanOptional(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
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
    attemptJobs: [],
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
  const attempts = input.attempts.map((attempt, index) => {
    const previousMemory = index > 0 ? input.iterationSnapshots?.[index - 1]?.improvementMemory : undefined;
    const memoryUsed = Array.isArray(attempt.memoryUsed)
      ? attempt.memoryUsed.map(sanitizeDkgMemoryText).filter(Boolean)
      : attempt.usedDkgMemory && previousMemory
        ? memoryValues(previousMemory)
        : [];
    const reconstructedPrompt = buildPrompt(target, memoryUsed, attempt.attemptNumber);
    const promptText = typeof attempt.promptText === "string" && attempt.promptText.trim()
      ? attempt.promptText
      : attempt.promptPreview || reconstructedPrompt;
    const promptHash = attempt.promptHash || hashValue(promptText);
    const knowledgeObservations = normalizeKnowledgeObservations(attempt, target.targetScore);
    const latestObservation = sanitizeDkgMemoryText(attempt.judgeOutputSummary);
    const normalized: AttemptRecord = {
      ...attempt,
      promptSummary: describePrompt(target, memoryUsed, attempt.attemptNumber),
      promptHash,
      promptText,
      promptTextVerified: hashValue(promptText) === promptHash,
      userDirectionApplied: Boolean(attempt.userDirectionApplied),
      memoryUsed,
      knowledgeObservations,
      nextPromptStrategy: sanitizeDkgMemoryText(
        attempt.nextPromptStrategy || ("Improve the next output using this visible evaluation: " + latestObservation)
      ),
      usedDkgMemory: Boolean(attempt.usedDkgMemory && memoryUsed.length),
      mediaType: attempt.mediaType || target.mediaType,
      generationCapability: attempt.generationCapability || mediaProfileFor(target.mediaType).capability,
      judgeScope: attempt.judgeScope || "blind-artifact",
      judgeOutputSummary: latestObservation
    };
    delete normalized.promptPreview;
    return normalized;
  });
  const attemptJobs = Array.isArray(input.attemptJobs) ? input.attemptJobs : [];
  const runLedger = buildRunLedger(sessionId, target, attempts);
  const improvementMemory = buildImprovementMemory(
    sessionId,
    target,
    attempts,
    input.improvementMemory?.["demo:updatedAt"]
  );
  const sourceSnapshots = Array.isArray(input.iterationSnapshots) && input.iterationSnapshots.length
    ? input.iterationSnapshots
    : buildIterationSnapshots({
        projectId,
        sessionId,
        createdAt,
        target,
        attempts,
        attemptJobs,
        runLedger,
        improvementMemory
      } as DemoState);
  const iterationSnapshots = sourceSnapshots.map((snapshot, index) => {
    const partialAttempts = attempts.slice(0, index + 1);
    const safeRunLedger = buildRunLedger(sessionId, target, partialAttempts);
    const safeImprovementMemory = buildImprovementMemory(
      sessionId,
      target,
      partialAttempts,
      snapshot.capturedAt
    );
    const snapshotState = {
      projectId,
      sessionId,
      createdAt,
      target,
      attempts: partialAttempts,
      attemptJobs,
      runLedger: safeRunLedger,
      improvementMemory: safeImprovementMemory,
      iterationSnapshots: [],
      receipt: {} as SubmissionReceipt,
      updatedAt: snapshot.capturedAt
    } as DemoState;
    const isLatest = index === sourceSnapshots.length - 1;
    const legacyShared = isLatest && input.receipt?.runLedgerReference?.startsWith("dkg:");
    return {
      ...snapshot,
      runLedger: safeRunLedger,
      improvementMemory: safeImprovementMemory,
      runLedgerRdf: buildRunLedgerTurtle(snapshotState),
      improvementMemoryRdf: buildImprovementMemoryTurtle(snapshotState),
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
    attemptJobs,
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
    activeProjectId: workspace.activeProjectId,
    updatedAt: new Date().toISOString()
  };
}

function buildPrompt(
  target: TargetSpec,
  memoryUsed: string[],
  attemptNumber: number,
  userDirection = ""
): string {
  const memoryBlock = memoryUsed.length
    ? `Use these DKG improvement notes: ${memoryUsed.join(" ")}`
    : "No prior DKG improvement memory is available. Make a first attempt from the target only.";
  const mediaInstruction = target.mediaType === "image"
    ? `Create a ${target.aspectRatio} image.`
    : `Create a ${target.durationSeconds ?? 6}-second ${target.aspectRatio} ${target.mediaType === "video-audio" ? "video with native audio" : "video"}.`;
  const lines = [
    `Attempt ${attemptNumber}: ${target.brief}`,
    mediaInstruction,
    `Success criteria: ${target.successCriteria.join(" ")}`,
    `Avoid: ${target.avoid.join(", ")}.`
  ];

  if (userDirection) {
    lines.push(`Creator direction for this Try: ${userDirection}`);
  }
  lines.push(memoryBlock, "Return a media output that can be judged against the visible criteria.");
  return lines.join("\n");
}
function normalizeKnowledgeObservations(
  attempt: AttemptRecord,
  targetScore: number
): KnowledgeObservation[] {
  const categories = new Set(["success", "failure", "constraint", "style"]);
  const relations = new Set(["supports", "needs-improvement", "violates", "refines"]);
  const source = Array.isArray(attempt.knowledgeObservations) ? attempt.knowledgeObservations : [];
  const normalized = source.flatMap((item): KnowledgeObservation[] => {
    if (!item || typeof item !== "object") return [];
    const category = String(item.category ?? "");
    const relation = String(item.relation ?? "");
    const body = sanitizeDkgMemoryText(item.body);
    if (!categories.has(category) || !relations.has(relation) || !body) return [];
    return [{
      category: category as KnowledgeObservation["category"],
      relation: relation as KnowledgeObservation["relation"],
      body,
      ...(Number.isInteger(item.criterionIndex) && Number(item.criterionIndex) >= 0
        ? { criterionIndex: Number(item.criterionIndex) }
        : {})
    }];
  }).slice(0, 12);
  if (normalized.length) return normalized;

  const body = sanitizeDkgMemoryText(attempt.judgeOutputSummary);
  return body ? [{
    category: attempt.score >= targetScore ? "success" : "failure",
    relation: attempt.score >= targetScore ? "supports" : "needs-improvement",
    body
  }] : [];
}


function describePrompt(target: TargetSpec, memoryUsed: string[], attemptNumber: number): string {
  const duration = target.durationSeconds ? `, ${target.durationSeconds}s` : "";
  return `Try ${attemptNumber}: ${target.mediaType}, ${target.aspectRatio}${duration}; ${memoryUsed.length} distilled DKG observations applied.`;
}

function hashValue(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function targetReference(target: TargetSpec): string {
  return hashValue(target.id).slice(0, 24);
}

function memoryValues(memory: ImprovementMemoryKa): string[] {
  return [...new Set([
    ...memory["demo:knownFailure"],
    ...memory["demo:successfulPattern"],
    memory["demo:nextPromptStrategy"]
  ].map(sanitizeDkgMemoryText).filter(Boolean))].slice(0, 12);
}

function isActiveJob(job: AttemptJob): boolean {
  return job.status === "generating" || job.status === "judging" || job.status === "sharing";
}

function safeJobError(phase: AttemptJob["phase"]): string {
  if (phase === "memory") return "DKG improvement memory could not be read.";
  if (phase === "generation") return "The remote media job did not produce an artifact.";
  if (phase === "judging") return "The artifact was produced, but blind evaluation did not complete.";
  if (phase === "dkg") return "The artifact was saved, but its DKG snapshot was not shared.";
  return "The attempt did not complete.";
}

function buildRunLedger(sessionId: string, target: TargetSpec, attempts: AttemptRecord[]): RunLedgerKa {
  const targetRef = targetReference(target);
  return {
    "@context": demoContext,
    "@id": `demo:run-ledger/${sessionId}/${targetRef}`,
    "@type": "demo:RunLedger",
    "demo:targetId": targetRef,
    "demo:sessionId": sessionId,
    "demo:hasAttempt": attempts.map((attempt) => {
      const attemptId = `demo:attempt/${sessionId}/${targetRef}/${attempt.attemptNumber}`;
      return {
        "@id": attemptId,
        "@type": "demo:GenerationAttempt",
        "demo:attemptNumber": attempt.attemptNumber,
        "demo:promptHash": attempt.promptHash,
        "demo:memoryObservationCount": attempt.memoryUsed.length,
        "demo:usedDkgMemory": attempt.usedDkgMemory,
        "demo:mediaType": attempt.mediaType,
        "demo:generationCapability": attempt.generationCapability,
        "demo:outputReference": attempt.outputReference,
        "demo:outputHash": attempt.outputHash,
        "demo:score": attempt.score,
        "demo:pass": attempt.pass,
        "demo:judgeOutputSummary": sanitizeDkgMemoryText(attempt.judgeOutputSummary),
        "demo:judgeReference": sanitizeDkgMemoryText(attempt.judgeReference ?? ""),
        "demo:judgeScope": attempt.judgeScope,
        "demo:createdAt": attempt.createdAt,
        "demo:generatedArtifact": {
          "@id": `demo:artifact/${sessionId}/${targetRef}/${attempt.attemptNumber}`,
          "@type": "demo:MediaArtifact",
          "demo:reference": attempt.outputReference,
          "demo:hash": attempt.outputHash,
          "demo:mediaType": attempt.mediaType
        },
        "demo:hasEvaluation": {
          "@id": `demo:evaluation/${sessionId}/${targetRef}/${attempt.attemptNumber}`,
          "@type": "demo:BlindEvaluation",
          "demo:score": attempt.score,
          "demo:pass": attempt.pass,
          "demo:summary": sanitizeDkgMemoryText(attempt.judgeOutputSummary),
          "demo:reference": sanitizeDkgMemoryText(attempt.judgeReference ?? "")
        },
        "demo:usedMemoryObservation": attempt.memoryUsed.map((value, index) => ({
          "@id": `demo:memory-input/${sessionId}/${targetRef}/${attempt.attemptNumber}/${index + 1}`,
          "@type": "demo:MemoryInput",
          "demo:contentHash": hashValue(value)
        }))
      };
    })
  };
}

function buildImprovementMemory(
  sessionId: string,
  target: TargetSpec,
  attempts: AttemptRecord[],
  updatedAt = new Date().toISOString()
): ImprovementMemoryKa {
  const targetRef = targetReference(target);
  const bestAttempt = attempts.reduce<AttemptRecord | undefined>(
    (best, attempt) => (!best || attempt.score > best.score ? attempt : best),
    undefined
  );
  const latest = attempts.at(-1);
  const observationNodes: ImprovementMemoryKa["demo:hasObservation"] = attempts.flatMap((attempt) =>
    attempt.knowledgeObservations.map((observation, index) => ({
      "@id": `demo:observation/${sessionId}/${targetRef}/${attempt.attemptNumber}/${index + 1}`,
      "@type": "demo:MemoryObservation" as const,
      "demo:category": observation.category,
      "demo:relation": observation.relation,
      "demo:body": sanitizeDkgMemoryText(observation.body),
      "demo:fromAttempt": { "@id": `demo:attempt/${sessionId}/${targetRef}/${attempt.attemptNumber}` },
      ...(observation.criterionIndex !== undefined
        ? { "demo:criterionIndex": observation.criterionIndex }
        : {})
    }))
  );
  const latestAttemptId = latest
    ? `demo:attempt/${sessionId}/${targetRef}/${latest.attemptNumber}`
    : "";
  const latestNodes = observationNodes.filter((node) => node["demo:fromAttempt"]["@id"] === latestAttemptId);
  const knownFailure = latestNodes
    .filter((node) => node["demo:category"] === "failure" || node["demo:category"] === "constraint")
    .map((node) => node["demo:body"]);
  const successfulPatterns = observationNodes
    .filter((node) => node["demo:category"] === "success" || node["demo:category"] === "style")
    .map((node) => node["demo:body"])
    .slice(-6);
  const nextPromptStrategy = latest?.nextPromptStrategy ||
    "Run the first attempt from the target brief, then judge it before creating improvement memory.";
  const strategy = {
    "@id": `demo:strategy/${sessionId}/${targetRef}/${latest?.attemptNumber ?? 0}`,
    "@type": "demo:PromptStrategy" as const,
    "demo:body": sanitizeDkgMemoryText(nextPromptStrategy),
    ...(latest ? { "demo:fromAttempt": { "@id": latestAttemptId } } : {})
  };

  return {
    "@context": demoContext,
    "@id": `demo:improvement-memory/${sessionId}/${targetRef}`,
    "@type": "demo:ImprovementMemory",
    "demo:targetId": targetRef,
    "demo:sessionId": sessionId,
    "demo:currentBestAttempt": bestAttempt
      ? `demo:attempt/${sessionId}/${targetRef}/${bestAttempt.attemptNumber}`
      : undefined,
    "demo:knownFailure": knownFailure,
    "demo:successfulPattern": successfulPatterns,
    "demo:nextPromptStrategy": strategy["demo:body"],
    "demo:hasObservation": observationNodes,
    "demo:hasStrategy": strategy,
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
