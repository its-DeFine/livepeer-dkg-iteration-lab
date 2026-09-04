import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createDirector } from "./director.js";

describe("Director improvement loop", () => {
  beforeEach(() => {
    process.env.LIVEPEER_MODE = "mock";
    process.env.DKG_MODE = "file";
    process.env.JUDGE_MODE = "mock";
  });

  it("records attempts and improves when DKG memory is used", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "iteration-lab-"));
    const director = createDirector(dataDir);

    const first = await director.runAttempt({ useDkgMemory: false });
    const second = await director.runAttempt({ useDkgMemory: true });

    expect(first.attempt.score).toBe(3);
    expect(second.attempt.score).toBeGreaterThan(first.attempt.score);
    expect(second.attempt.usedDkgMemory).toBe(true);
    expect(second.attempt.judgeReference).toContain("mock:judge");
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
  });
});
