export type RuntimeMode = "mock" | "real";
export type DkgMode = "file" | "cli";
export type MediaType = "image" | "video" | "video-audio";
export type AspectRatio = "1:1" | "16:9" | "9:16";

export interface MediaProfile {
  mediaType: MediaType;
  label: string;
  capability: string;
  description: string;
  durationRequired: boolean;
  nativeAudio: boolean;
}

export interface TargetSpec {
  id: string;
  title: string;
  brief: string;
  mediaType: MediaType;
  durationSeconds?: number;
  aspectRatio: AspectRatio;
  successCriteria: string[];
  avoid: string[];
  targetScore: number;
}
export type KnowledgeObservationCategory = "success" | "failure" | "constraint" | "style";
export type KnowledgeRelation = "supports" | "needs-improvement" | "violates" | "refines";

export interface KnowledgeObservation {
  category: KnowledgeObservationCategory;
  relation: KnowledgeRelation;
  body: string;
  criterionIndex?: number;
}

export interface MemoryObservationNode {
  "@id": string;
  "@type": "demo:MemoryObservation";
  "demo:category": KnowledgeObservationCategory;
  "demo:relation": KnowledgeRelation;
  "demo:body": string;
  "demo:fromAttempt": { "@id": string };
  "demo:criterionIndex"?: number;
}

export interface PromptStrategyNode {
  "@id": string;
  "@type": "demo:PromptStrategy";
  "demo:body": string;
  "demo:fromAttempt"?: { "@id": string };
}


export type AttemptJobStatus = "generating" | "judging" | "sharing" | "completed" | "failed";
export type AttemptJobPhase = "memory" | "generation" | "judging" | "dkg" | "complete";

export interface AttemptJob {
  id: string;
  projectId: string;
  attemptNumber: number;
  useDkgMemory: boolean;
  status: AttemptJobStatus;
  phase: AttemptJobPhase;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
}

export interface AttemptRecord {
  id: string;
  attemptNumber: number;
  promptSummary: string;
  promptHash: string;
  promptText: string;
  promptTextVerified: boolean;
  userDirectionApplied: boolean;
  memoryUsed: string[];
  promptPreview?: string;
  knowledgeObservations: KnowledgeObservation[];
  nextPromptStrategy: string;
  usedDkgMemory: boolean;
  mediaType: MediaType;
  generationCapability: string;
  outputReference: string;
  outputHash?: string;
  score: number;
  pass: boolean;
  judgeScope?: "blind-artifact";
  judgeOutputSummary: string;
  judgeReference?: string;
  createdAt: string;
}

export interface RunLedgerKa {
  "@context": Record<string, string>;
  "@id": string;
  "@type": "demo:RunLedger";
  "demo:targetId": string;
  "demo:sessionId": string;
  "demo:hasAttempt": Array<Record<string, unknown>>;
}

export interface ImprovementMemoryKa {
  "@context": Record<string, string>;
  "@id": string;
  "@type": "demo:ImprovementMemory";
  "demo:targetId": string;
  "demo:sessionId": string;
  "demo:currentBestAttempt"?: string;
  "demo:knownFailure": string[];
  "demo:successfulPattern": string[];
  "demo:nextPromptStrategy": string;
  "demo:latestScore": number;
  "demo:hasObservation": MemoryObservationNode[];
  "demo:hasStrategy": PromptStrategyNode;
  "demo:updatedAt": string;
}

export interface DkgSnapshotStatus {
  state: "recorded" | "shared" | "pending" | "failed";
  layer: "local" | "WM" | "SWM";
  runLedgerReference?: string;
  improvementMemoryReference?: string;
  recordedAt?: string;
}

export interface IterationSnapshot {
  attemptNumber: number;
  attemptId: string;
  artifactReference: string;
  artifactHash?: string;
  runLedger: RunLedgerKa;
  improvementMemory: ImprovementMemoryKa;
  runLedgerRdf: string;
  improvementMemoryRdf: string;
  dkg: DkgSnapshotStatus;
  capturedAt: string;
}

export interface SubmissionReceipt {
  projectId: string;
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
  projectId: string;
  sessionId: string;
  createdAt: string;
  target: TargetSpec;
  attempts: AttemptRecord[];
  attemptJobs: AttemptJob[];
  runLedger: RunLedgerKa;
  improvementMemory: ImprovementMemoryKa;
  iterationSnapshots: IterationSnapshot[];
  receipt: SubmissionReceipt;
  updatedAt: string;
}

export interface WorkspaceState {
  projects: DemoState[];
  activeProjectId: string;
  updatedAt: string;
}

export interface ConfigStatus {
  livepeerMode: RuntimeMode;
  dkgMode: DkgMode;
  judgeMode: RuntimeMode;
  livepeerConfigured: boolean;
  dkgConfigured: boolean;
  judgeConfigured: boolean;
  mediaProfiles: MediaProfile[];
}

export interface CreateProjectRequest {
  title: string;
  brief: string;
  mediaType: MediaType;
  durationSeconds?: number;
  aspectRatio: AspectRatio;
  successCriteria: string[];
  avoid: string[];
  targetScore: number;
}

export interface RunAttemptRequest {
  projectId?: string;
  useDkgMemory: boolean;
  userDirection?: string;
}

export interface RunAttemptResponse {
  workspace: WorkspaceState;
  state: DemoState;
  attempt: AttemptRecord;
  memoryUsed: string[];
}
