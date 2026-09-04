import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AttemptRecord, DemoState } from "../../shared/types.js";
import { JsonStateStore } from "../storage.js";

const execFileAsync = promisify(execFile);
const baseIri = "https://atumera.com/hackathon/iteration-lab/";

export interface DkgWriteResult {
  runLedgerReference: string;
  improvementMemoryReference: string;
  receiptReference: string;
}

export interface DkgAdapter {
  writeState(state: DemoState): Promise<DkgWriteResult>;
  readMemory(state: DemoState): Promise<string[]>;
}

export class FileDkgAdapter implements DkgAdapter {
  constructor(private readonly store: JsonStateStore) {}

  async writeState(state: DemoState): Promise<DkgWriteResult> {
    const version = Math.max(1, state.attempts.length);
    const prefix = `snapshots/${state.projectId}/try-${version}`;
    const runLedgerReference = await this.store.writeJson(`${prefix}/run-ledger-ka.jsonld`, state.runLedger);
    const improvementMemoryReference = await this.store.writeJson(
      `${prefix}/improvement-memory-ka.jsonld`,
      state.improvementMemory
    );
    await this.store.writeText(`${prefix}/run-ledger-ka.ttl`, buildRunLedgerTurtle(state));
    await this.store.writeText(`${prefix}/improvement-memory-ka.ttl`, buildImprovementMemoryTurtle(state));
    const receiptReference = await this.store.writeJson(`receipts/${state.projectId}.json`, state.receipt);

    return {
      runLedgerReference,
      improvementMemoryReference,
      receiptReference
    };
  }

  async readMemory(state: DemoState): Promise<string[]> {
    return sanitizeMemoryValues([
      ...state.improvementMemory["demo:knownFailure"],
      ...state.improvementMemory["demo:successfulPattern"],
      state.improvementMemory["demo:nextPromptStrategy"]
    ]);
  }
}

export class DkgCliAdapter implements DkgAdapter {
  private readonly fileAdapter: FileDkgAdapter;
  private resolvedContextGraphId?: string;

  constructor(
    private readonly store: JsonStateStore,
    private readonly cliBin: string,
    private readonly configuredContextGraphId: string,
    private readonly contextGraphName: string,
    private readonly runLedgerKaName: string,
    private readonly improvementMemoryKaName: string
  ) {
    this.fileAdapter = new FileDkgAdapter(store);
  }

  async writeState(state: DemoState): Promise<DkgWriteResult> {
    const files = await this.fileAdapter.writeState(state);
    const runLedgerTurtle = await this.store.writeText("run-ledger-ka.ttl", buildRunLedgerTurtle(state));
    const improvementMemoryTurtle = await this.store.writeText(
      "improvement-memory-ka.ttl",
      buildImprovementMemoryTurtle(state)
    );
    const version = Math.max(1, state.attempts.length);
    const contextGraphId = await this.resolveContextGraphId();
    const runLedgerKaName = scopedKaName(this.runLedgerKaName, state.sessionId, version);
    const improvementMemoryKaName = scopedKaName(this.improvementMemoryKaName, state.sessionId, version);

    await this.ensureVersionShared(runLedgerKaName, contextGraphId, runLedgerTurtle);
    await this.ensureVersionShared(improvementMemoryKaName, contextGraphId, improvementMemoryTurtle);

    if (state.attempts.length > 0) {
      await this.verifyLatestAttemptReadable(contextGraphId, state);
    }

    return {
      runLedgerReference: `dkg:${contextGraphId}/${runLedgerKaName}`,
      improvementMemoryReference: `dkg:${contextGraphId}/${improvementMemoryKaName}`,
      receiptReference: files.receiptReference
    };
  }

  private async resolveContextGraphId(): Promise<string> {
    if (this.resolvedContextGraphId) {
      return this.resolvedContextGraphId;
    }

    if (this.configuredContextGraphId && this.configuredContextGraphId !== "auto") {
      this.resolvedContextGraphId = this.configuredContextGraphId;
      return this.resolvedContextGraphId;
    }

    if (!this.contextGraphName) {
      throw new Error("DKG_CONTEXT_GRAPH_ID or DKG_CONTEXT_GRAPH_NAME is required when DKG_MODE=cli.");
    }

    const list = await this.run(["context-graph", "list"]);
    const existing = parseContextGraphList(list, this.contextGraphName);
    if (existing) {
      this.resolvedContextGraphId = existing;
      return existing;
    }

    const created = await this.run(["context-graph", "create", this.contextGraphName]);
    const createdId = parseCreatedContextGraphId(created);
    if (!createdId) {
      throw new Error("DKG context graph was created but its ID could not be parsed.");
    }

    this.resolvedContextGraphId = createdId;
    return createdId;
  }

  private async ensureVersionShared(name: string, contextGraphId: string, inputFile: string): Promise<void> {
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      try {
        const status = await this.knowledgeAssetStatus(name, contextGraphId);
        if (!status) {
          await this.run(["ka", "create", name, "-c", contextGraphId, "--input-file", inputFile, "--share"]);
        } else if (!isSharedKnowledgeAsset(status)) {
          if (!isFinalizedKnowledgeAsset(status)) {
            await this.run(["ka", "write", name, "-c", contextGraphId, "--input-file", inputFile]);
            await this.run(["ka", "finalize", name, "-c", contextGraphId]);
          }
          await this.run(["ka", "share", name, "-c", contextGraphId]);
        }

        const verified = await this.knowledgeAssetStatus(name, contextGraphId);
        if (verified && isSharedKnowledgeAsset(verified)) {
          return;
        }
        throw new Error("DKG knowledge asset share is still pending.");
      } catch (error) {
        if (!isRetryableShareError(error) || attempt === 4) {
          throw error;
        }
        await delay(attempt * 1500);
      }
    }
  }

  private async knowledgeAssetStatus(
    name: string,
    contextGraphId: string
  ): Promise<Record<string, unknown> | null> {
    try {
      return JSON.parse(await this.run(["ka", "status", name, "-c", contextGraphId])) as Record<string, unknown>;
    } catch (error) {
      if (error instanceof Error && /No knowledge asset/i.test(error.message)) {
        return null;
      }
      throw error;
    }
  }

  async readMemory(state: DemoState): Promise<string[]> {
    if (state.attempts.length === 0) {
      return [];
    }

    const contextGraphId = await this.resolveContextGraphId();
    const latest = state.attempts.at(-1);
    if (!latest) {
      return [];
    }

    const query = `PREFIX il: <https://atumera.com/hackathon/iteration-lab#>
SELECT DISTINCT ?body WHERE {
  VALUES (?target ?sourceAttempt) {
    (${targetIri(state)} ${attemptIri(state, latest)})
    (${legacyTargetIri(state)} ${legacyAttemptIri(state, latest)})
  }
  ?thing il:forTarget ?target ;
    il:fromAttempt ?sourceAttempt ;
    il:body ?body .
}`;

    const output = await this.run(["query", contextGraphId, "--include-shared-memory", "--sparql", query]);
    const parsed = JSON.parse(output) as { bindings?: Array<{ body?: string }> };
    const values = (parsed.bindings ?? []).map((binding) => parseSparqlLiteral(binding.body ?? ""));
    return sanitizeMemoryValues(values);
  }

  private async verifyLatestAttemptReadable(contextGraphId: string, state: DemoState): Promise<void> {
    const latest = state.attempts.at(-1);
    if (!latest) {
      return;
    }

    const query = `PREFIX il: <https://atumera.com/hackathon/iteration-lab#>
SELECT ?attempt ?score WHERE {
  ?attempt a il:LivepeerRun ;
    il:forTarget ${targetIri(state)} ;
    il:attemptNumber ${latest.attemptNumber} ;
    il:evaluationScore ?score .
}
LIMIT 1`;

    const output = await this.run(["query", contextGraphId, "--include-shared-memory", "--sparql", query]);
    const parsed = JSON.parse(output) as { bindings?: unknown[] };
    if (!Array.isArray(parsed.bindings) || parsed.bindings.length === 0) {
      throw new Error("DKG readback verification failed: latest attempt was not queryable from Shared Working Memory.");
    }
  }

  private async run(args: string[]): Promise<string> {
    try {
      const { stdout } = await execFileAsync(this.cliBin, args, {
        timeout: 90000,
        maxBuffer: 1024 * 1024 * 4,
        env: process.env
      });
      return stdout;
    } catch (error) {
      throw new Error(redactDkgError(error));
    }
  }
}

function parseContextGraphList(output: string, contextGraphName: string): string | undefined {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/)[0])
    .find((id) => id === contextGraphName || id.endsWith(`/${contextGraphName}`));
}

function parseCreatedContextGraphId(output: string): string | undefined {
  return output.match(/ID:\s+([^\s]+)/)?.[1];
}

function isSharedKnowledgeAsset(status: Record<string, unknown>): boolean {
  return status.memoryLayer === "SWM" || status.state === "promoted" || status.status === "swm-shared";
}

function isFinalizedKnowledgeAsset(status: Record<string, unknown>): boolean {
  return status.state === "finalized" || status.status === "wm-finalized";
}

function isRetryableShareError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /already exists|already finalized|unfinished promote|retry assertionPromote|share operation|promotion|fan-out|watchdog|timeout|still pending/i.test(
      error.message
    )
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function parseSparqlLiteral(value: string): string {
  const quote = String.fromCharCode(34);
  const slash = String.fromCharCode(92);
  if (!value.startsWith(quote)) {
    return value;
  }

  let escaped = false;
  for (let index = 1; index < value.length; index += 1) {
    const char = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === slash) {
      escaped = true;
      continue;
    }
    if (char === quote) {
      try {
        return JSON.parse(value.slice(0, index + 1)) as string;
      } catch {
        return value.slice(1, index);
      }
    }
  }

  return value;
}

function redactDkgError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [redacted]")
    .replace(/(private|mnemonic|secret|seed|token|password|key)[^\n]*/gi, "$1 [redacted]")
    .replace(/0x[a-fA-F0-9]{64,}/g, "0x[redacted-hex]")
    .slice(0, 1000);
}

export function buildRunLedgerTurtle(state: DemoState): string {
  const target = targetIri(state);
  const lines = [prefixes()];

  lines.push(`${target} a il:Target ;`);
  lines.push(`  il:targetFingerprint ${literal(targetFingerprint(state))} ;`);
  lines.push(`  il:targetScore ${state.target.targetScore} .`);
  lines.push(`${target} il:mediaType ${literal(state.target.mediaType)} .`);
  lines.push(`${target} il:aspectRatio ${literal(state.target.aspectRatio)} .`);
  lines.push(`${target} il:successCriterionCount ${state.target.successCriteria.length} .`);
  lines.push(`${target} il:avoidRuleCount ${state.target.avoid.length} .`);
  if (state.target.durationSeconds) {
    lines.push(`${target} il:durationSeconds ${state.target.durationSeconds} .`);
  }

  for (const attempt of state.attempts) {
    lines.push(attemptTurtle(state, attempt));
  }

  return `${lines.join("\n")}\n`;
}

function attemptTurtle(state: DemoState, attempt: AttemptRecord): string {
  const run = attemptIri(state, attempt);
  const artifact = artifactIri(state, attempt);
  const evaluation = evaluationIri(state, attempt);
  const lines = [
    `${run} a il:LivepeerRun ;`,
    `  il:forTarget ${targetIri(state)} ;`,
    `  il:generatedArtifact ${artifact} ;`,
    `  il:hasEvaluation ${evaluation} ;`,
    `  il:attemptNumber ${attempt.attemptNumber} ;`,
    `  il:usedDkgMemory ${attempt.usedDkgMemory ? "true" : "false"} ;`,
    `  il:mediaType ${literal(attempt.mediaType)} ;`,
    `  il:generationCapability ${literal(attempt.generationCapability)} ;`,
    `  il:promptHash ${literal(attempt.promptHash)} ;`,
    `  il:memoryObservationCount ${attempt.memoryUsed.length} ;`,
    `  il:outputReference ${literal(attempt.outputReference)} ;`,
    `  il:outputHash ${literal(attempt.outputHash ?? "")} ;`,
    `  il:evaluationScore ${attempt.score} ;`,
    `  il:passedTarget ${attempt.pass ? "true" : "false"} ;`,
    `  il:judgeOutput ${literal(sanitizeDkgMemoryText(attempt.judgeOutputSummary))} ;`,
    `  il:judgeReference ${literal(sanitizeDkgReference(attempt.judgeReference ?? ""))} ;`,
    `  il:judgeScope ${literal(attempt.judgeScope ?? "previous-evaluation")} ;`,
    `  il:createdAt ${dateTimeLiteral(attempt.createdAt)} .`,
    `${artifact} a il:MediaArtifact ;`,
    `  il:reference ${literal(attempt.outputReference)} ;`,
    `  il:contentHash ${literal(attempt.outputHash ?? "")} ;`,
    `  il:mediaType ${literal(attempt.mediaType)} .`,
    `${evaluation} a il:BlindEvaluation ;`,
    `  il:evaluationScore ${attempt.score} ;`,
    `  il:passedTarget ${attempt.pass ? "true" : "false"} ;`,
    `  il:judgeOutput ${literal(sanitizeDkgMemoryText(attempt.judgeOutputSummary))} ;`,
    `  il:judgeReference ${literal(sanitizeDkgReference(attempt.judgeReference ?? ""))} .`
  ];

  attempt.memoryUsed.forEach((value, index) => {
    const input = memoryInputIri(state, attempt, index);
    lines.push(`${run} il:usedMemoryObservation ${input} .`);
    lines.push(`${input} a il:MemoryInput ;`);
    lines.push(`  il:contentHash ${literal(crypto.createHash("sha256").update(value).digest("hex"))} .`);
  });
  return lines.join("\n");
}

export function buildImprovementMemoryTurtle(state: DemoState): string {
  const target = targetIri(state);
  const memory = iri(`memory/${state.sessionId}/${targetFingerprint(state)}`);
  const latest = state.attempts.at(-1);
  const strategy = strategyIri(state, latest?.attemptNumber ?? 0);
  const lines = [prefixes()];

  lines.push(`${memory} a il:ImprovementMemory ;`);
  lines.push(`  il:forTarget ${target} ;`);
  lines.push(`  il:latestScore ${state.improvementMemory["demo:latestScore"]} ;`);
  lines.push(`  il:updatedAt ${dateTimeLiteral(state.improvementMemory["demo:updatedAt"])} .`);

  state.attempts.forEach((attempt) => {
    attempt.knowledgeObservations.forEach((item, index) => {
      const observation = observationIri(state, attempt, index);
      lines.push(`${memory} il:hasObservation ${observation} .`);
      lines.push(`${observation} a il:MemoryObservation ;`);
      lines.push(`  il:forTarget ${target} ;`);
      lines.push(`  il:fromAttempt ${attemptIri(state, attempt)} ;`);
      lines.push(`  il:category ${literal(item.category)} ;`);
      lines.push(`  il:relation ${literal(item.relation)} ;`);
      if (item.criterionIndex !== undefined) {
        lines.push(`  il:criterionIndex ${item.criterionIndex} ;`);
      }
      lines.push(`  il:body ${literal(sanitizeDkgMemoryText(item.body))} .`);
    });
  });

  lines.push(`${memory} il:hasStrategy ${strategy} .`);
  lines.push(`${strategy} a il:PromptStrategy ;`);
  lines.push(`  il:forTarget ${target} ;`);
  if (latest) {
    lines.push(`  il:fromAttempt ${attemptIri(state, latest)} ;`);
  }
  lines.push(`  il:body ${literal(sanitizeDkgMemoryText(state.improvementMemory["demo:nextPromptStrategy"]))} .`);

  return `${lines.join("\n")}\n`;
}

function scopedKaName(baseName: string, sessionId: string, version: number): string {
  return `${baseName}-${slug(sessionId)}-try-${version}`.slice(0, 120);
}

function targetIri(state: DemoState): string {
  return iri(`target/${state.sessionId}/${targetFingerprint(state)}`);
}

function attemptIri(state: DemoState, attempt: Pick<AttemptRecord, "attemptNumber">): string {
  return iri(`attempt/${state.sessionId}/${targetFingerprint(state)}/${attempt.attemptNumber}`);
}
function artifactIri(state: DemoState, attempt: Pick<AttemptRecord, "attemptNumber">): string {
  return iri(`artifact/${state.sessionId}/${targetFingerprint(state)}/${attempt.attemptNumber}`);
}

function evaluationIri(state: DemoState, attempt: Pick<AttemptRecord, "attemptNumber">): string {
  return iri(`evaluation/${state.sessionId}/${targetFingerprint(state)}/${attempt.attemptNumber}`);
}

function memoryInputIri(
  state: DemoState,
  attempt: Pick<AttemptRecord, "attemptNumber">,
  index: number
): string {
  return iri(`memory-input/${state.sessionId}/${targetFingerprint(state)}/${attempt.attemptNumber}/${index + 1}`);
}

function observationIri(
  state: DemoState,
  attempt: Pick<AttemptRecord, "attemptNumber">,
  index: number
): string {
  return iri(`observation/${state.sessionId}/${targetFingerprint(state)}/${attempt.attemptNumber}/${index + 1}`);
}

function strategyIri(state: DemoState, attemptNumber: number): string {
  return iri(`strategy/${state.sessionId}/${targetFingerprint(state)}/${attemptNumber}`);
}


function legacyTargetIri(state: DemoState): string {
  return iri(`target/${state.sessionId}/${state.target.id}`);
}

function legacyAttemptIri(state: DemoState, attempt: Pick<AttemptRecord, "attemptNumber">): string {
  return iri(`attempt/${state.sessionId}/${state.target.id}/${attempt.attemptNumber}`);
}

function targetFingerprint(state: DemoState): string {
  return crypto.createHash("sha256").update(state.target.id).digest("hex").slice(0, 24);
}

function prefixes(): string {
  return [
    "@prefix il: <https://atumera.com/hackathon/iteration-lab#> .",
    "@prefix schema: <https://schema.org/> .",
    "@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .",
    ""
  ].join("\n");
}

function iri(path: string): string {
  return `<${baseIri}${path.split("/").map(slug).join("/")}>`;
}

function slug(value: string | number): string {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "item";
}

export function sanitizeDkgMemoryText(value: string): string {
  return String(value)
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/(?:\+?\d[\d().\s-]{7,}\d)/g, "[redacted-phone]")
    .replace(/\b(api[_ -]?key|token|password|secret|mnemonic|private[_ -]?key)\b\s*[:=]?\s*[^\s,;]+/gi, "$1 [redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function sanitizeMemoryValues(values: string[]): string[] {
  return [...new Set(values.map(sanitizeDkgMemoryText).filter(Boolean))].slice(0, 12);
}

function sanitizeDkgReference(value: string): string {
  return String(value)
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function literal(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

function dateTimeLiteral(value: string): string {
  return `${literal(value)}^^xsd:dateTime`;
}

export function createDkgAdapter(store: JsonStateStore): DkgAdapter {
  if (process.env.DKG_MODE === "cli") {
    return new DkgCliAdapter(
      store,
      process.env.DKG_CLI_BIN ?? "dkg",
      process.env.DKG_CONTEXT_GRAPH_ID ?? "",
      process.env.DKG_CONTEXT_GRAPH_NAME ?? "iteration-lab-demo",
      process.env.DKG_RUN_LEDGER_KA_NAME ?? "iteration-lab-run-ledger",
      process.env.DKG_IMPROVEMENT_MEMORY_KA_NAME ?? "iteration-lab-improvement-memory"
    );
  }

  return new FileDkgAdapter(store);
}
