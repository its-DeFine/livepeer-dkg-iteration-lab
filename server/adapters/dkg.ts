import type { DemoState } from "../../shared/types.js";
import { JsonStateStore } from "../storage.js";

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

export function createDkgAdapter(store: JsonStateStore): DkgAdapter {
  return new FileDkgAdapter(store);
}
