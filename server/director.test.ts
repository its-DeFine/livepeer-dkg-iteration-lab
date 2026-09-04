import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDirector } from "./director.js";
import { buildJudgePrompt } from "./adapters/judge.js";
import { DkgCliAdapter } from "./adapters/dkg.js";
import { JsonStateStore } from "./storage.js";
import { supportedMediaProfiles } from "./adapters/livepeer.js";

describe("Director workspace", () => {
  beforeEach(() => {
    process.env.LIVEPEER_MODE = "mock";
    process.env.DKG_MODE = "file";
    process.env.JUDGE_MODE = "mock";
    delete process.env.DKG_CLI_BIN;
  });

  it("keeps immutable asset snapshots while the blind judge sees only target and artifact", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "iteration-lab-"));
    const director = createDirector(dataDir);
    const workspace = await director.getWorkspace();
    const project = workspace.projects[0];

    const first = await director.runAttempt({ projectId: project.projectId, useDkgMemory: false });
    const second = await director.runAttempt({ projectId: project.projectId, useDkgMemory: true });

    expect(second.attempt.usedDkgMemory).toBe(true);
    expect(second.attempt.judgeScope).toBe("blind-artifact");
    expect(second.state.runLedger["demo:hasAttempt"]).toHaveLength(2);
    expect(second.state.iterationSnapshots).toHaveLength(2);
    expect(second.state.iterationSnapshots[0].runLedger["demo:hasAttempt"]).toHaveLength(1);
    expect(second.state.iterationSnapshots[1].runLedger["demo:hasAttempt"]).toHaveLength(2);
    expect(second.state.iterationSnapshots[1].runLedgerRdf).toContain("il:LivepeerRun");
    expect(second.state.iterationSnapshots[1].improvementMemoryRdf).toContain("il:ImprovementMemory");
    expect(second.state.iterationSnapshots[1].dkg.state).toBe("shared");

    const ledger = await readFile(
      path.join(dataDir, "snapshots", project.projectId, "try-2", "run-ledger-ka.jsonld"),
      "utf8"
    );
    expect(ledger).toContain("demo:RunLedger");

    const judgePrompt = buildJudgePrompt({
      target: first.state.target,
      media: {
        outputReference: first.attempt.outputReference,
        outputHash: first.attempt.outputHash ?? "",
        mediaType: first.attempt.mediaType,
        capability: first.attempt.generationCapability
      }
    });
    expect(judgePrompt).not.toContain("DKG");
    expect(judgePrompt).not.toContain("memory");
    expect(judgePrompt).not.toContain("Attempt number");
    expect(judgePrompt).not.toContain(first.attempt.outputReference);
  });

  it("keeps a running attempt attached to its project while another project becomes active", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "iteration-lab-concurrency-"));
    const director = createDirector(dataDir);
    const initial = await director.getWorkspace();
    const sourceProjectId = initial.activeProjectId;

    const attemptPromise = director.runAttempt({ projectId: sourceProjectId, useDkgMemory: false });
    const createdPromise = director.createProject({
      title: "Second Product",
      brief: "Create a clean second product reveal.",
      mediaType: "image",
      aspectRatio: "1:1",
      successCriteria: ["The second product is clear."],
      avoid: ["unreadable text"],
      targetScore: 8
    });

    const [, created] = await Promise.all([attemptPromise, createdPromise]);
    const final = await director.getWorkspace();
    expect(final.projects).toHaveLength(2);
    expect(final.activeProjectId).toBe(created.activeProjectId);
    expect(final.projects.find((item) => item.projectId === sourceProjectId)?.attempts).toHaveLength(1);
    expect(final.projects.find((item) => item.projectId === sourceProjectId)?.attemptJobs.at(-1)?.status).toBe("completed");
  });

  it("shares fingerprints and sanitized evidence instead of target or prompt text", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "iteration-lab-private-"));
    const director = createDirector(dataDir);
    const created = await director.createProject({
      title: "Private Aurora owner@example.com",
      brief: "Internal launch token=privatevalue for +30 6912 345 678.",
      mediaType: "image",
      aspectRatio: "16:9",
      successCriteria: ["Show confidential-title-4711 clearly."],
      avoid: ["secret-label-8822"],
      targetScore: 8
    });
    const result = await director.runAttempt({
      projectId: created.activeProjectId,
      useDkgMemory: false,
      userDirection: "Keep private-directive-4711 in the final prompt only."
    });
    const snapshot = result.state.iterationSnapshots[0];
    const shared = JSON.stringify({
      runLedger: snapshot.runLedger,
      improvementMemory: snapshot.improvementMemory,
      runLedgerRdf: snapshot.runLedgerRdf,
      improvementMemoryRdf: snapshot.improvementMemoryRdf
    });

    expect(result.attempt.promptHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.attempt.promptText).toContain("private-directive-4711");
    expect(result.attempt.promptTextVerified).toBe(true);
    expect(result.attempt.userDirectionApplied).toBe(true);
    expect(result.attempt.knowledgeObservations.length).toBeGreaterThan(0);
    expect(result.state.improvementMemory["demo:hasObservation"].length).toBeGreaterThan(0);
    expect(Object.hasOwn(result.attempt, "promptPreview")).toBe(false);
    expect(shared).not.toContain("owner@example.com");
    expect(shared).not.toContain("privatevalue");
    expect(shared).not.toContain("confidential-title-4711");
    expect(shared).not.toContain("secret-label-8822");
    expect(shared).not.toContain("promptPreview");
    expect(shared).not.toContain("private-directive-4711");
    expect(shared).not.toContain("promptText");
    expect(snapshot.runLedgerRdf).toContain("il:generatedArtifact");
    expect(snapshot.runLedgerRdf).toContain("il:hasEvaluation");
    expect(snapshot.improvementMemoryRdf).toContain("il:hasObservation");
    expect(snapshot.improvementMemoryRdf).toContain("il:hasStrategy");
    expect(snapshot.improvementMemoryRdf).toContain("il:relation");
    expect(shared).not.toContain("promptSummary");
  });

  it("creates and switches independent products with only supported remote media modes", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "iteration-lab-projects-"));
    const director = createDirector(dataDir);
    const initial = await director.getWorkspace();
    const firstProject = initial.projects[0];

    const created = await director.createProject({
      title: "Aurora Launch",
      brief: "Create a bright product reveal with an audible sonic identity.",
      mediaType: "video-audio",
      durationSeconds: 6,
      aspectRatio: "9:16",
      successCriteria: ["The product is clear.", "The audio supports the reveal."],
      avoid: ["unreadable text"],
      targetScore: 8
    });
    const secondProject = created.projects.find((project) => project.projectId === created.activeProjectId)!;
    expect(created.projects).toHaveLength(2);
    expect(secondProject.target.mediaType).toBe("video-audio");
    expect(secondProject.receipt.projectId).toBe(secondProject.projectId);

    const result = await director.runAttempt({ projectId: secondProject.projectId, useDkgMemory: false });
    expect(result.attempt.generationCapability).toContain("pixverse-t2v");
    expect(result.attempt.generationCapability).toContain("sonilo-v2m");
    expect(result.attempt.generationCapability).toContain("ffmpeg-mux");
    expect(result.state.attempts).toHaveLength(1);
    expect(result.workspace.projects.find((project) => project.projectId === firstProject.projectId)?.attempts).toHaveLength(0);

    const switched = await director.selectProject(firstProject.projectId);
    expect(switched.activeProjectId).toBe(firstProject.projectId);
    expect(supportedMediaProfiles().map((profile) => profile.mediaType)).toEqual(["image", "video", "video-audio"]);
  });

  it("migrates one legacy project without losing its attempts", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "iteration-lab-migrate-"));
    const director = createDirector(dataDir);
    const initial = await director.getWorkspace();
    const project = initial.projects[0];
    await director.runAttempt({ projectId: project.projectId, useDkgMemory: false });
    const saved = JSON.parse(await readFile(path.join(dataDir, "workspace-state.json"), "utf8"));
    const legacy = saved.projects[0];
    delete legacy.projectId;
    delete legacy.createdAt;
    delete legacy.target.mediaType;
    delete legacy.target.aspectRatio;
    for (const attempt of legacy.attempts) {
      delete attempt.mediaType;
      delete attempt.generationCapability;
      attempt.promptPreview = "legacy private prompt owner@example.com";
      delete attempt.promptHash;
      delete attempt.promptText;
      delete attempt.promptTextVerified;
      delete attempt.memoryUsed;
    }
    const migrationDir = await mkdtemp(path.join(tmpdir(), "iteration-lab-legacy-"));
    await writeFile(path.join(migrationDir, "runtime-state.json"), JSON.stringify(legacy));
    const migrated = await createDirector(migrationDir).getWorkspace();
    expect(migrated.projects).toHaveLength(1);
    expect(migrated.projects[0].attempts).toHaveLength(1);
    expect(migrated.projects[0].target.mediaType).toBe("image");
    expect(migrated.projects[0].iterationSnapshots[0].runLedgerRdf).toContain("il:LivepeerRun");
    expect(migrated.projects[0].attempts[0].promptHash).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.hasOwn(migrated.projects[0].attempts[0], "promptPreview")).toBe(false);
    expect(migrated.projects[0].attempts[0].promptTextVerified).toBe(false);
    await createDirector(migrationDir).selectProject(migrated.activeProjectId);
    const roundtrip = await createDirector(migrationDir).getWorkspace();
    expect(roundtrip.projects[0].attempts[0].promptTextVerified).toBe(false);
    expect(JSON.stringify(migrated.projects[0].runLedger)).not.toContain("legacy private prompt");
  });

  it("keeps a completed artifact visible when the DKG write fails", async () => {
    process.env.DKG_MODE = "cli";
    process.env.DKG_CLI_BIN = "/missing/dkg-cli";
    process.env.DKG_CONTEXT_GRAPH_NAME = "iteration-lab-test";
    const dataDir = await mkdtemp(path.join(tmpdir(), "iteration-lab-dkg-failure-"));
    const director = createDirector(dataDir);
    const initial = await director.getWorkspace();
    const projectId = initial.activeProjectId;

    await expect(director.runAttempt({ projectId, useDkgMemory: false })).rejects.toThrow();

    const recovered = await director.getWorkspace();
    const project = recovered.projects[0];
    expect(project.attempts).toHaveLength(1);
    expect(project.iterationSnapshots).toHaveLength(1);
    expect(project.iterationSnapshots[0].dkg.state).toBe("failed");
    expect(project.attempts[0].judgeScope).toBe("blind-artifact");
    expect(project.receipt.outputReferences).toHaveLength(1);
  });


  it("preserves captured asset projections and never infers sharing from a receipt", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "iteration-lab-history-"));
    const director = createDirector(dataDir);
    const initial = await director.getWorkspace();
    await director.runAttempt({ projectId: initial.activeProjectId, useDkgMemory: false });
    const file = path.join(dataDir, "workspace-state.json");
    const saved = JSON.parse(await readFile(file, "utf8"));
    const snapshot = saved.projects[0].iterationSnapshots[0];
    snapshot.runLedger["demo:historicalMarker"] = "Captured original ledger";
    snapshot.improvementMemory["demo:nextPromptStrategy"] = "Captured original strategy";
    snapshot.runLedgerRdf = "# captured ledger RDF\n";
    snapshot.improvementMemoryRdf = "# captured memory RDF\n";
    delete snapshot.dkg;
    saved.projects[0].receipt.runLedgerReference = "dkg:receipt-is-not-proof";
    await writeFile(file, JSON.stringify(saved));
    const loaded = await director.getWorkspace();
    const captured = loaded.projects[0].iterationSnapshots[0];
    expect(captured.runLedger).toEqual(snapshot.runLedger);
    expect(captured.improvementMemory).toEqual(snapshot.improvementMemory);
    expect(captured.runLedgerRdf).toBe(snapshot.runLedgerRdf);
    expect(captured.improvementMemoryRdf).toBe(snapshot.improvementMemoryRdf);
    expect(captured.dkg).toEqual({ state: "recorded", layer: "local" });
    await director.runAttempt({ projectId: initial.activeProjectId, useDkgMemory: true });
    const after = await director.getWorkspace();
    expect(after.projects[0].iterationSnapshots[0]).toEqual(captured);
  });

  it("queries reusable graph categories and reads typed SPARQL values", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "iteration-lab-query-"));
    const director = createDirector(dataDir);
    const initial = await director.getWorkspace();
    const result = await director.runAttempt({ projectId: initial.activeProjectId, useDkgMemory: false });
    const adapter = new DkgCliAdapter(new JsonStateStore(dataDir), "unused", "test-context", "", "ledger", "memory");
    const run = vi.spyOn(adapter as unknown as { run(args: string[]): Promise<string> }, "run").mockResolvedValue(JSON.stringify({
      bindings: [{ body: { type: "literal", value: "Preserve the clear silhouette." } }, { body: "Use a simpler final frame." }]
    }));
    const memory = await adapter.readMemory(result.state);
    expect(memory).toEqual(["Preserve the clear silhouette.", "Use a simpler final frame."]);
    const args = run.mock.calls[0][0];
    expect(args).toContain("--include-shared-memory");
    const query = args[args.indexOf("--sparql") + 1];
    expect(query).toContain('?category = "success"');
    expect(query).toContain('?category = "style"');
    expect(query).toContain("?sourceAttempt = ?latestAttempt");
    expect(query).toContain("il:PromptStrategy");
    expect(query).not.toContain("UNION");
    expect(query).toContain("OPTIONAL { ?thing il:category ?category . }");
    expect(query).not.toContain(result.attempt.promptText);
    run.mockRestore();
  });

  it("persists a visible failed job when remote generation cannot start", async () => {
    process.env.LIVEPEER_MODE = "real";
    delete process.env.LIVEPEER_MCP_URL;
    const dataDir = await mkdtemp(path.join(tmpdir(), "iteration-lab-job-failure-"));
    const director = createDirector(dataDir);
    const initial = await director.getWorkspace();

    await expect(director.runAttempt({
      projectId: initial.activeProjectId,
      useDkgMemory: false
    })).rejects.toThrow();

    const recovered = await director.getWorkspace();
    const project = recovered.projects[0];
    expect(project.attempts).toHaveLength(0);
    expect(project.attemptJobs).toHaveLength(1);
    expect(project.attemptJobs[0]).toMatchObject({ status: "failed", phase: "generation" });
    expect(project.attemptJobs[0].error).toBe("The remote media job did not produce an artifact.");

    await expect(director.runAttempt({
      projectId: initial.activeProjectId,
      useDkgMemory: false
    })).rejects.toThrow();

    const retried = await director.getWorkspace();
    expect(retried.projects[0].attemptJobs).toHaveLength(2);
    expect(retried.projects[0].attemptJobs[1].attemptNumber).toBe(1);
  });
});
