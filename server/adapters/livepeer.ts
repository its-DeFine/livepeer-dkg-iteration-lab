import crypto from "node:crypto";
import type { TargetSpec } from "../../shared/types.js";

export interface GenerateMediaInput {
  attemptNumber: number;
  prompt: string;
  target: TargetSpec;
}

export interface GenerateMediaOutput {
  outputReference: string;
  outputHash: string;
}

export interface LivepeerAdapter {
  generate(input: GenerateMediaInput): Promise<GenerateMediaOutput>;
}

export class MockLivepeerAdapter implements LivepeerAdapter {
  async generate(input: GenerateMediaInput): Promise<GenerateMediaOutput> {
    const seed = `${input.target.id}:${input.attemptNumber}:${input.prompt}`;
    const hash = crypto.createHash("sha256").update(seed).digest("hex");
    return {
      outputReference: `https://example.invalid/livepeer-output/${input.target.id}/attempt-${input.attemptNumber}`,
      outputHash: hash
    };
  }
}

export class LivepeerMcpAdapter implements LivepeerAdapter {
  private sessionId?: string;
  private initialized = false;

  constructor(
    private readonly endpoint: string,
    private readonly capability = "flux-schnell",
    private readonly bearer?: string,
    private readonly timeoutSeconds = 36
  ) {}

  async generate(input: GenerateMediaInput): Promise<GenerateMediaOutput> {
    if (!this.endpoint) {
      throw new Error("LIVEPEER_MCP_URL is required for real Livepeer mode.");
    }

    await this.initialize();

    const idempotencySeed = crypto
      .createHash("sha256")
      .update(`${input.target.id}:${input.attemptNumber}:${input.prompt}`)
      .digest("hex")
      .slice(0, 40);

    const payload = await this.callJsonRpc("tools/call", {
      name: "run_capability",
      arguments: {
        capability: this.capability,
        prompt: input.prompt,
        timeout: this.timeoutSeconds,
        async: false,
        persist: false,
        session_id: `iteration_lab_${safeId(input.target.id)}`,
        idempotency_key: `il_${idempotencySeed}`
      }
    });

    if (payload.error || (payload.result as { isError?: boolean } | undefined)?.isError) {
      const errorText = collectResultText(payload) || JSON.stringify(payload.error ?? payload);
      throw new Error(`Livepeer capability failed: ${errorText.slice(0, 600)}`);
    }

    const resultText = collectResultText(payload) || JSON.stringify(payload.result ?? payload);
    const outputHash = crypto.createHash("sha256").update(resultText).digest("hex");

    return {
      outputReference: extractReference(payload) ?? `livepeer:${this.capability}:${outputHash.slice(0, 16)}`,
      outputHash
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
        name: "livepeer-dkg-iteration-lab",
        version: "0.1.0"
      }
    });

    if (payload.error) {
      throw new Error(`Livepeer MCP initialization failed: ${JSON.stringify(payload.error)}`);
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
        ...(this.bearer ? { authorization: `Bearer ${this.bearer}` } : {})
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
      throw new Error(`Livepeer request failed with status ${response.status}: ${text.slice(0, 400)}`);
    }

    return JSON.parse(text) as Record<string, unknown>;
  }
}

function extractReference(payload: Record<string, unknown>): string | undefined {
  const haystack = `${collectResultText(payload)}\n${JSON.stringify(payload)}`;
  const urlMatch = haystack.match(/https?:\/\/[^"'\s)]+/);
  if (urlMatch) {
    return urlMatch[0].replace(/[.,]+$/, "");
  }
  const idValue = payload.id ?? (payload.result as Record<string, unknown> | undefined)?.id;
  return typeof idValue === "string" ? `livepeer:job:${idValue}` : undefined;
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

export function createLivepeerAdapter(): LivepeerAdapter {
  if (process.env.LIVEPEER_MODE === "real") {
    return new LivepeerMcpAdapter(
      process.env.LIVEPEER_MCP_URL ?? "",
      process.env.LIVEPEER_CAPABILITY ?? "flux-schnell",
      process.env.LIVEPEER_MCP_BEARER,
      Number(process.env.LIVEPEER_TIMEOUT_SECONDS ?? 36)
    );
  }

  return new MockLivepeerAdapter();
}
