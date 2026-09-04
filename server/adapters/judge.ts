import crypto from "node:crypto";
import type { ImprovementMemoryKa, TargetSpec } from "../../shared/types.js";
import type { GenerateMediaOutput } from "./livepeer.js";

export interface JudgeInput {
  attemptNumber: number;
  usedDkgMemory: boolean;
  memoryUsed: string[];
  prompt: string;
  target: TargetSpec;
  media: GenerateMediaOutput;
  improvementMemory: ImprovementMemoryKa;
}

export interface JudgeOutput {
  score: number;
  feedback: string;
  reference: string;
}

export interface JudgeAdapter {
  judge(input: JudgeInput): Promise<JudgeOutput>;
}

export class MockJudgeAdapter implements JudgeAdapter {
  async judge(input: JudgeInput): Promise<JudgeOutput> {
    if (input.attemptNumber === 1 || !input.usedDkgMemory) {
      return {
        score: 3,
        feedback:
          "The output has a usable cinematic direction, but the product is not explicit enough and the ending frame is not yet clean.",
        reference: "mock:judge:first-pass"
      };
    }

    const priorScore = input.improvementMemory["demo:latestScore"] || 3;
    const score = Math.min(9, priorScore + 3);
    const feedback =
      score >= 8
        ? "The output now preserves the cinematic tone, makes the product clearer, and gives the final frame a stronger thumbnail shape."
        : "The output improves product visibility and tone, but the final frame still needs a clearer ending composition.";
    return { score, feedback, reference: "mock:judge:dkg-memory-pass" };
  }
}

export class LivepeerJudgeAdapter implements JudgeAdapter {
  private sessionId?: string;
  private initialized = false;

  constructor(
    private readonly endpoint: string,
    private readonly capability = "gemini-text",
    private readonly bearer?: string,
    private readonly timeoutSeconds = 60
  ) {}

  async judge(input: JudgeInput): Promise<JudgeOutput> {
    if (!this.endpoint) {
      throw new Error("LIVEPEER_MCP_URL or JUDGE_LIVEPEER_MCP_URL is required when JUDGE_MODE=real.");
    }

    await this.initialize();

    const judgePrompt = buildJudgePrompt(input);
    const idempotencySeed = crypto
      .createHash("sha256")
      .update([input.target.id, input.attemptNumber, input.media.outputHash, judgePrompt].join(":"))
      .digest("hex")
      .slice(0, 40);

    const payload = await this.callJsonRpc("tools/call", {
      name: "run_capability",
      arguments: {
        capability: this.capability,
        prompt: judgePrompt,
        source_url: input.media.outputReference,
        timeout: this.timeoutSeconds,
        async: false,
        persist: false,
        session_id: "iteration_lab_judge_" + safeId(input.target.id),
        idempotency_key: "il_judge_" + idempotencySeed
      }
    });

    if (payload.error || (payload.result as { isError?: boolean } | undefined)?.isError) {
      const errorText = collectResultText(payload) || JSON.stringify(payload.error ?? payload);
      throw new Error("Livepeer judge failed: " + errorText.slice(0, 600));
    }

    const resultText = collectResultText(payload) || JSON.stringify(payload.result ?? payload);
    const parsed = parseJudgeJson(resultText);
    const score = clampScore(parsed.score);
    const feedback = normalizeFeedback(parsed.feedback);
    const resultHash = crypto.createHash("sha256").update(resultText).digest("hex");

    return {
      score,
      feedback,
      reference: "livepeer:" + this.capability + ":" + resultHash.slice(0, 16)
    };
  }

  private async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const payload = await this.callJsonRpc("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: {
        name: "livepeer-dkg-iteration-lab-judge",
        version: "0.1.0"
      }
    });

    if (payload.error) {
      throw new Error("Livepeer judge MCP initialization failed: " + JSON.stringify(payload.error));
    }

    this.initialized = true;
  }

  private async callJsonRpc(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(this.sessionId ? { "mcp-session-id": this.sessionId } : {}),
        ...(this.bearer ? { authorization: "Bearer " + this.bearer } : {})
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: crypto.randomUUID(),
        method,
        params
      })
    });

    this.sessionId = response.headers.get("mcp-session-id") ?? this.sessionId;
    const text = await response.text();

    if (!response.ok) {
      throw new Error("Livepeer judge request failed with status " + response.status + ": " + text.slice(0, 400));
    }

    return JSON.parse(text) as Record<string, unknown>;
  }
}

function buildJudgePrompt(input: JudgeInput): string {
  const memorySection = input.memoryUsed.length
    ? input.memoryUsed.map((item, index) => String(index + 1) + ". " + item).join("\n")
    : "No DKG memory was used for this attempt.";

  return [
    "You are the LLM judge for a public Livepeer + DKG hackathon demo.",
    "Evaluate the iteration evidence and the generated media reference against the target brief.",
    "Return only compact JSON with this exact shape: {\"score\":number,\"feedback\":string}.",
    "Scoring rubric:",
    "- 1-4: first/blind attempt, weak product clarity, or no useful memory application.",
    "- 5-7: useful output direction and DKG memory was applied, but the result still needs improvement.",
    "- 8-10: DKG memory clearly improved the prompt and the output is likely ready against the criteria.",
    "Keep feedback to one sentence. Do not mention local computers, paths, credentials, or auth setup.",
    "Target title: " + input.target.title,
    "Target brief: " + input.target.brief,
    "Success criteria: " + input.target.successCriteria.join(" | "),
    "Avoid: " + input.target.avoid.join(" | "),
    "Attempt number: " + input.attemptNumber,
    "Used DKG memory: " + String(input.usedDkgMemory),
    "DKG memory facts used:\n" + memorySection,
    "Prompt sent to Livepeer:\n" + input.prompt,
    "Livepeer output reference: " + input.media.outputReference,
    "Livepeer output hash: " + input.media.outputHash
  ].join("\n");
}

function parseJudgeJson(value: string): { score: unknown; feedback: unknown } {
  const parsed = parseAnyJson(value);
  if (hasJudgeFields(parsed)) {
    return parsed;
  }

  if (parsed && typeof parsed === "object" && "text" in parsed && typeof parsed.text === "string") {
    const nested = parseAnyJson(parsed.text);
    if (hasJudgeFields(nested)) {
      return nested;
    }
  }

  throw new Error("Livepeer judge returned JSON without score and feedback fields.");
}

function parseAnyJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    const match = value.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]) as unknown;
    }
  }

  throw new Error("Livepeer judge returned non-JSON output: " + value.slice(0, 300));
}

function hasJudgeFields(value: unknown): value is { score: unknown; feedback: unknown } {
  return Boolean(value && typeof value === "object" && "score" in value && "feedback" in value);
}

function clampScore(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error("Livepeer judge returned an invalid score.");
  }
  return Math.max(1, Math.min(10, Math.round(numeric)));
}

function normalizeFeedback(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Livepeer judge returned empty feedback.");
  }
  return value.replace(/\s+/g, " ").trim().slice(0, 500);
}

function collectResultText(payload: Record<string, unknown>): string {
  const content = (payload.result as { content?: Array<{ text?: string }> } | undefined)?.content;
  if (!Array.isArray(content)) {
    return "";
  }
  return content.map((item) => item.text).filter(Boolean).join("\n");
}

function safeId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80) || "demo";
}

export function createJudgeAdapter(): JudgeAdapter {
  if (process.env.JUDGE_MODE === "real") {
    return new LivepeerJudgeAdapter(
      process.env.JUDGE_LIVEPEER_MCP_URL || process.env.LIVEPEER_MCP_URL || "",
      process.env.JUDGE_LIVEPEER_CAPABILITY || "gemini-text",
      process.env.JUDGE_LIVEPEER_MCP_BEARER || process.env.LIVEPEER_MCP_BEARER,
      Number(process.env.JUDGE_TIMEOUT_SECONDS ?? 60)
    );
  }

  return new MockJudgeAdapter();
}
