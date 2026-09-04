export type RuntimeMode = "mock" | "real";
export type DkgMode = "file" | "cli";

export interface TargetSpec {
  id: string;
  title: string;
  brief: string;
  successCriteria: string[];
  avoid: string[];
  targetScore: number;
}

export interface AttemptRecord {
  id: string;
  attemptNumber: number;
  promptSummary: string;
  promptPreview: string;
  usedDkgMemory: boolean;
  outputReference: string;
  outputHash?: string;
  score: number;
  pass: boolean;
  judgeOutputSummary: string;
  createdAt: string;
}

export interface RunLedgerKa {
  "@context": Record<string, string>;
  "@id": string;
  "@type": "demo:RunLedger";
  "demo:targetId": string;
  "demo:hasAttempt": Array<Record<string, unknown>>;
}

export interface ImprovementMemoryKa {
  "@context": Record<string, string>;
  "@id": string;
  "@type": "demo:ImprovementMemory";
  "demo:targetId": string;
  "demo:currentBestAttempt"?: string;
  "demo:knownFailure": string[];
  "demo:successfulPattern": string[];
  "demo:nextPromptStrategy": string;
  "demo:latestScore": number;
  "demo:updatedAt": string;
}

export interface SubmissionReceipt {
  targetId: string;
  exportedAt: string;
  bestAttemptId?: string;
  bestScore: number;
  attemptCount: number;
  outputReferences: string[];
  runLedgerReference: string;
  improvementMemoryReference: string;
  safetyNote: string;
}

export interface DemoState {
  target: TargetSpec;
  attempts: AttemptRecord[];
  runLedger: RunLedgerKa;
  improvementMemory: ImprovementMemoryKa;
  receipt: SubmissionReceipt;
  updatedAt: string;
}

export interface ConfigStatus {
  livepeerMode: RuntimeMode;
  dkgMode: DkgMode;
  judgeMode: RuntimeMode;
  livepeerConfigured: boolean;
  dkgConfigured: boolean;
}

export interface RunAttemptRequest {
  target?: TargetSpec;
  useDkgMemory: boolean;
}

export interface RunAttemptResponse {
  state: DemoState;
  attempt: AttemptRecord;
  memoryUsed: string[];
}
