import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createDirector } from "./director.js";
import { buildJudgePrompt } from "./adapters/judge.js";
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
    expect(result.attempt.generationCapability).toBe("ltx-25-t2v-fast");
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
    }
    const migrationDir = await mkdtemp(path.join(tmpdir(), "iteration-lab-legacy-"));
    await writeFile(path.join(migrationDir, "runtime-state.json"), JSON.stringify(legacy));
    const migrated = await createDirector(migrationDir).getWorkspace();
    expect(migrated.projects).toHaveLength(1);
    expect(migrated.projects[0].attempts).toHaveLength(1);
    expect(migrated.projects[0].target.mediaType).toBe("image");
    expect(migrated.projects[0].iterationSnapshots[0].runLedgerRdf).toContain("il:LivepeerRun");
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
});
