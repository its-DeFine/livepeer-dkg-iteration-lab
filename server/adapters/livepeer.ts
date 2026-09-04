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
  constructor(
    private readonly endpoint: string,
    private readonly toolName = "create_media",
    private readonly bearer?: string
  ) {}

  async generate(input: GenerateMediaInput): Promise<GenerateMediaOutput> {
    if (!this.endpoint) {
      throw new Error("LIVEPEER_MCP_URL is required for real Livepeer mode.");
    }

    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.bearer ? { authorization: `Bearer ${this.bearer}` } : {})
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `attempt-${input.attemptNumber}`,
        method: "tools/call",
        params: {
          name: this.toolName,
          arguments: {
            prompt: input.prompt
          }
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Livepeer request failed with status ${response.status}.`);
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const resultText = JSON.stringify(payload.result ?? payload);
    const outputHash = crypto.createHash("sha256").update(resultText).digest("hex");

    return {
      outputReference: extractReference(payload) ?? `livepeer:mcp:${outputHash.slice(0, 16)}`,
      outputHash
    };
  }
}

function extractReference(payload: Record<string, unknown>): string | undefined {
  const haystack = JSON.stringify(payload);
  const urlMatch = haystack.match(/https?:\/\/[^"\\\s]+/);
  if (urlMatch) {
    return urlMatch[0];
  }
  const idValue = payload.id ?? (payload.result as Record<string, unknown> | undefined)?.id;
  return typeof idValue === "string" ? `livepeer:job:${idValue}` : undefined;
}

export function createLivepeerAdapter(): LivepeerAdapter {
  if (process.env.LIVEPEER_MODE === "real") {
    return new LivepeerMcpAdapter(
      process.env.LIVEPEER_MCP_URL ?? "",
      process.env.LIVEPEER_MCP_TOOL ?? "create_media",
      process.env.LIVEPEER_MCP_BEARER
    );
  }

  return new MockLivepeerAdapter();
}
