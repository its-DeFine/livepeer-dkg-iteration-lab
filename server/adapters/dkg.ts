import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DemoState } from "../../shared/types.js";
import { JsonStateStore } from "../storage.js";

const execFileAsync = promisify(execFile);

export interface DkgWriteResult {
  runLedgerReference: string;
  improvementMemoryReference: string;
  receiptReference: string;
}

export interface DkgAdapter {
  writeState(state: DemoState): Promise<DkgWriteResult>;
}

export class FileDkgAdapter implements DkgAdapter {
  constructor(private readonly store: JsonStateStore) {}

  async writeState(state: DemoState): Promise<DkgWriteResult> {
    const runLedgerReference = await this.store.writeJson("run-ledger-ka.jsonld", state.runLedger);
    const improvementMemoryReference = await this.store.writeJson(
      "improvement-memory-ka.jsonld",
      state.improvementMemory
    );
    const receiptReference = await this.store.writeJson("submission-receipt.json", state.receipt);

    return {
      runLedgerReference,
      improvementMemoryReference,
      receiptReference
    };
  }
}

export class DkgCliAdapter implements DkgAdapter {
  private readonly fileAdapter: FileDkgAdapter;

  constructor(
    store: JsonStateStore,
    private readonly cliBin: string,
    private readonly contextGraphId: string
  ) {
    this.fileAdapter = new FileDkgAdapter(store);
  }

  async writeState(state: DemoState): Promise<DkgWriteResult> {
    if (!this.contextGraphId) {
      throw new Error("DKG_CONTEXT_GRAPH_ID is required when DKG_MODE=cli.");
    }

    const files = await this.fileAdapter.writeState(state);
    await this.createOrWriteKnowledgeAsset("run-ledger", files.runLedgerReference);
    await this.createOrWriteKnowledgeAsset("improvement-memory", files.improvementMemoryReference);

    return {
      runLedgerReference: `dkg:${this.contextGraphId}/run-ledger`,
      improvementMemoryReference: `dkg:${this.contextGraphId}/improvement-memory`,
      receiptReference: files.receiptReference
    };
  }

  private async createOrWriteKnowledgeAsset(name: string, inputFile: string): Promise<void> {
    const createArgs = ["ka", "create", name, "-c", this.contextGraphId, "--input-file", inputFile, "--share"];

    try {
      await this.run(createArgs);
      return;
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        throw error;
      }
    }

    await this.run(["ka", "write", name, "-c", this.contextGraphId, "--input-file", inputFile]);
    await this.run(["ka", "finalize", name, "-c", this.contextGraphId]);
    await this.run(["ka", "share", name, "-c", this.contextGraphId]);
  }

  private async run(args: string[]): Promise<void> {
    try {
      await execFileAsync(this.cliBin, args, {
        timeout: 30000,
        maxBuffer: 1024 * 1024
      });
    } catch (error) {
      throw new Error(redactDkgError(error));
    }
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return error instanceof Error && /already exists|exists|duplicate/i.test(error.message);
}

function redactDkgError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [redacted]")
    .replace(/0x[a-fA-F0-9]{40}/g, "0x[redacted]")
    .slice(0, 500);
}

export function createDkgAdapter(store: JsonStateStore): DkgAdapter {
  if (process.env.DKG_MODE === "cli") {
    return new DkgCliAdapter(
      store,
      process.env.DKG_CLI_BIN ?? "dkg",
      process.env.DKG_CONTEXT_GRAPH_ID ?? ""
    );
  }

  return new FileDkgAdapter(store);
}
