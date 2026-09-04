import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDirector } from "./director.js";

describe("Director improvement loop", () => {
  it("records attempts and improves when DKG memory is used", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "iteration-lab-"));
    const director = createDirector(dataDir);

    const first = await director.runAttempt({ useDkgMemory: false });
    const second = await director.runAttempt({ useDkgMemory: true });

    expect(first.attempt.score).toBe(3);
    expect(second.attempt.score).toBeGreaterThan(first.attempt.score);
    expect(second.attempt.usedDkgMemory).toBe(true);
    expect(second.state.runLedger["demo:hasAttempt"]).toHaveLength(2);
    expect(second.state.improvementMemory["demo:latestScore"]).toBe(second.attempt.score);

    const ledger = await readFile(path.join(dataDir, "run-ledger-ka.jsonld"), "utf8");
    expect(ledger).toContain("demo:RunLedger");
  });
});
