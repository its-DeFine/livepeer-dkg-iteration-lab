import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createDirector } from "./director.js";
import { buildJudgePrompt } from "./adapters/judge.js";

describe("Director improvement loop", () => {
  beforeEach(() => {
    process.env.LIVEPEER_MODE = "mock";
    process.env.DKG_MODE = "file";
    process.env.JUDGE_MODE = "mock";
  });

  it("records attempts and snapshots while keeping the judge blind to orchestration context", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "iteration-lab-"));
    const director = createDirector(dataDir);

    const first = await director.runAttempt({ useDkgMemory: false });
    const second = await director.runAttempt({ useDkgMemory: true });

    expect(first.attempt.score).toBeGreaterThanOrEqual(4);
    expect(second.attempt.score).toBeGreaterThanOrEqual(4);
    expect(second.attempt.usedDkgMemory).toBe(true);
    expect(second.attempt.judgeReference).toContain("mock:judge");
    expect(second.attempt.judgeScope).toBe("blind-artifact");
    expect(second.state.sessionId).toContain("session-");
    expect(second.state.runLedger["demo:hasAttempt"]).toHaveLength(2);
    expect(second.state.improvementMemory["demo:latestScore"]).toBe(second.attempt.score);
    expect(second.state.iterationSnapshots).toHaveLength(2);
    expect(second.state.iterationSnapshots[0].runLedger["demo:hasAttempt"]).toHaveLength(1);
    expect(second.state.iterationSnapshots[1].runLedger["demo:hasAttempt"]).toHaveLength(2);
    expect(second.state.iterationSnapshots[0].improvementMemory["demo:latestScore"]).toBe(first.attempt.score);
    expect(second.state.iterationSnapshots[1].artifactReference).toBe(second.attempt.outputReference);

    const ledger = await readFile(path.join(dataDir, "run-ledger-ka.jsonld"), "utf8");
    expect(ledger).toContain("demo:RunLedger");
    expect(second.state.receipt.runLedgerReference).toContain("run-ledger-ka.jsonld");

    const receipt = await readFile(path.join(dataDir, "submission-receipt.json"), "utf8");
    expect(receipt).toContain("run-ledger-ka.jsonld");
    const judgePrompt = buildJudgePrompt({
      target: first.state.target,
      media: {
        outputReference: first.attempt.outputReference,
        outputHash: first.attempt.outputHash ?? ""
      }
    });
    expect(judgePrompt).not.toContain("DKG");
    expect(judgePrompt).not.toContain("memory");
    expect(judgePrompt).not.toContain("Attempt number");
    expect(judgePrompt).not.toContain("Prompt sent");
    expect(judgePrompt).not.toContain(first.attempt.outputReference);
  });

  it("keeps a completed artifact visible when the DKG write fails", async () => {
    process.env.DKG_MODE = "cli";
    process.env.DKG_CLI_BIN = "/missing/dkg-cli";
    process.env.DKG_CONTEXT_GRAPH_NAME = "iteration-lab-test";
    const dataDir = await mkdtemp(path.join(tmpdir(), "iteration-lab-dkg-failure-"));
    const director = createDirector(dataDir);

    await expect(director.runAttempt({ useDkgMemory: false })).rejects.toThrow();

    const recovered = await director.getState();
    expect(recovered.attempts).toHaveLength(1);
    expect(recovered.iterationSnapshots).toHaveLength(1);
    expect(recovered.attempts[0].judgeScope).toBe("blind-artifact");
    expect(recovered.receipt.outputReferences).toHaveLength(1);
  });
});
