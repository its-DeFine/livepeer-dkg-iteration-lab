import crypto from "node:crypto";
import type { TargetSpec } from "../../shared/types.js";
import type { GenerateMediaOutput } from "./livepeer.js";

export interface JudgeInput {
  target: TargetSpec;
  media: GenerateMediaOutput;
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
    const score = 4 + (Number.parseInt(input.media.outputHash.slice(0, 2), 16) % 5);
    const feedback =
      score >= 7
        ? "The artifact satisfies most visible criteria, with a clear subject, cinematic tone, and a usable composition."
        : "The artifact has a usable direction, but visible product clarity and the final composition need improvement.";
    return { score, feedback, reference: "mock:judge:blind-artifact" };
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
      .update([input.target.id, input.media.outputHash, judgePrompt].join(":"))
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
        session_id: "iteration_lab_blind_judge_" + safeId(input.target.id),
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

export function buildJudgePrompt(input: JudgeInput): string {
  return [
    "You are an independent media quality judge.",
    "Evaluate only the supplied media artifact against the target brief and visible success criteria.",
    "Do not infer or evaluate how the artifact was generated, its provenance, prior runs, or hidden context.",
    "Return only compact JSON with this exact shape: {\"score\":number,\"feedback\":string}.",
    "Scoring rubric:",
    "- 1-3: the visible artifact misses most criteria.",
    "- 4-6: the visible artifact partially satisfies the criteria but has major shortcomings.",
    "- 7-8: the visible artifact satisfies the criteria with minor shortcomings.",
    "- 9-10: the visible artifact satisfies the criteria exceptionally well.",
    "Keep feedback to one sentence and discuss only qualities visible in the artifact.",
    "Target title: " + input.target.title,
    "Target brief: " + input.target.brief,
    "Success criteria: " + input.target.successCriteria.join(" | "),
    "Avoid: " + input.target.avoid.join(" | ")
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
