import crypto from "node:crypto";
import type { MediaProfile, MediaType, TargetSpec } from "../../shared/types.js";

export interface GenerateMediaInput {
  attemptNumber: number;
  prompt: string;
  target: TargetSpec;
}

export interface GenerateMediaOutput {
  outputReference: string;
  outputHash: string;
  mediaType: MediaType;
  capability: string;
}

export interface LivepeerAdapter {
  generate(input: GenerateMediaInput): Promise<GenerateMediaOutput>;
}

const profiles: Record<MediaType, MediaProfile> = {
  image: {
    mediaType: "image",
    label: "Image",
    capability: "flux-schnell",
    description: "Fast image generation for visual concepts and keyframes.",
    durationRequired: false,
    nativeAudio: false
  },
  video: {
    mediaType: "video",
    label: "Video",
    capability: "flux-3-draft-t2v",
    description: "Short text-to-video generation without a local model.",
    durationRequired: true,
    nativeAudio: false
  },
  "video-audio": {
    mediaType: "video-audio",
    label: "Video + audio",
    capability: "ltx-25-t2v-fast",
    description: "Short text-to-video generation with native audio.",
    durationRequired: true,
    nativeAudio: true
  }
};

export function supportedMediaProfiles(): MediaProfile[] {
  return Object.values(profiles);
}

export function mediaProfileFor(mediaType: MediaType): MediaProfile {
  return profiles[mediaType] ?? profiles.image;
}

export class MockLivepeerAdapter implements LivepeerAdapter {
  async generate(input: GenerateMediaInput): Promise<GenerateMediaOutput> {
    const profile = mediaProfileFor(input.target.mediaType);
    const seed = `${input.target.id}:${input.attemptNumber}:${input.prompt}`;
    const hash = crypto.createHash("sha256").update(seed).digest("hex");
    return {
      outputReference: `https://example.invalid/livepeer-output/${input.target.id}/attempt-${input.attemptNumber}`,
      outputHash: hash,
      mediaType: input.target.mediaType,
      capability: profile.capability
    };
  }
}

export class LivepeerMcpAdapter implements LivepeerAdapter {
  private sessionId?: string;
  private initialized = false;

  constructor(
    private readonly endpoint: string,
    private readonly bearer?: string
  ) {}

  async generate(input: GenerateMediaInput): Promise<GenerateMediaOutput> {
    if (!this.endpoint) {
      throw new Error("Livepeer generation is not configured.");
    }

    await this.initialize();
    const profile = configuredProfile(input.target.mediaType);
    const idempotencySeed = crypto
      .createHash("sha256")
      .update(`${input.target.id}:${input.attemptNumber}:${input.prompt}`)
      .digest("hex")
      .slice(0, 40);
    const isAsync = process.env.LIVEPEER_ASYNC_JOBS === "true";
    const timeout = timeoutFor(input.target.mediaType);
    const argumentsValue: Record<string, unknown> = {
      capability: profile.capability,
      prompt: input.prompt,
      timeout,
      async: isAsync,
      persist: false,
      session_id: `iteration_lab_${safeId(input.target.id)}`,
      idempotency_key: `il_${idempotencySeed}`
    };

    if (profile.durationRequired) {
      argumentsValue.inputs = {
        duration: Math.max(input.target.mediaType === "video-audio" ? 6 : 1, input.target.durationSeconds ?? 6),
        aspect_ratio: input.target.aspectRatio
      };
    } else {
      argumentsValue.inputs = { aspect_ratio: input.target.aspectRatio };
    }

    let payload = await this.callTool("run_capability", argumentsValue);
    assertToolSuccess(payload, "Livepeer generation");

    if (isAsync) {
      const jobId = extractJobId(payload);
      if (!jobId) {
        throw new Error("Livepeer accepted the media job but did not return a job id.");
      }
      payload = await this.waitForJob(jobId, timeout);
    }

    const resultText = collectResultText(payload) || JSON.stringify(payload.result ?? payload);
    const outputHash = crypto.createHash("sha256").update(resultText).digest("hex");
    const outputReference = extractReference(payload);
    if (!outputReference) {
      throw new Error("Livepeer completed the media job without a usable output reference.");
    }

    return {
      outputReference,
      outputHash,
      mediaType: input.target.mediaType,
      capability: profile.capability
    };
  }

  private async waitForJob(jobId: string, timeoutSeconds: number): Promise<Record<string, unknown>> {
    const deadline = Date.now() + timeoutSeconds * 1000;
    while (Date.now() < deadline) {
      const payload = await this.callTool("get_create_media", { job_id: jobId });
      assertToolSuccess(payload, "Livepeer media job");
      const text = `${collectResultText(payload)} ${JSON.stringify(payload.result ?? {})}`;
      if (/failed|cancelled|error/i.test(text)) {
        throw new Error("Livepeer media job failed before producing an output.");
      }
      if (extractReference(payload) && !/queued|pending|processing|running/i.test(text)) {
        return payload;
      }
      await delay(5000);
    }
    throw new Error("Livepeer media job timed out before producing an output.");
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return;
    const payload = await this.callJsonRpc("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "livepeer-dkg-iteration-lab", version: "0.2.0" }
    });
    if (payload.error) {
      throw new Error("Livepeer MCP initialization failed.");
    }
    this.initialized = true;
  }

  private async callTool(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.callJsonRpc("tools/call", { name, arguments: args });
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
      body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method, params })
    });

    this.sessionId = response.headers.get("mcp-session-id") ?? this.sessionId;
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Livepeer request failed with status ${response.status}.`);
    }
    return JSON.parse(text) as Record<string, unknown>;
  }
}

function configuredProfile(mediaType: MediaType): MediaProfile {
  const profile = { ...mediaProfileFor(mediaType) };
  if (mediaType === "image") {
    profile.capability = process.env.LIVEPEER_IMAGE_CAPABILITY || process.env.LIVEPEER_CAPABILITY || profile.capability;
  } else if (mediaType === "video") {
    profile.capability = process.env.LIVEPEER_VIDEO_CAPABILITY || profile.capability;
  } else {
    profile.capability = process.env.LIVEPEER_VIDEO_AUDIO_CAPABILITY || profile.capability;
  }
  return profile;
}

function timeoutFor(mediaType: MediaType): number {
  if (mediaType === "image") return Number(process.env.LIVEPEER_IMAGE_TIMEOUT_SECONDS ?? 36);
  if (mediaType === "video") return Number(process.env.LIVEPEER_VIDEO_TIMEOUT_SECONDS ?? 360);
  return Number(process.env.LIVEPEER_VIDEO_AUDIO_TIMEOUT_SECONDS ?? 300);
}

function assertToolSuccess(payload: Record<string, unknown>, label: string): void {
  if (payload.error || (payload.result as { isError?: boolean } | undefined)?.isError) {
    const errorText = collectResultText(payload) || JSON.stringify(payload.error ?? {});
    throw new Error(`${label} failed: ${errorText.slice(0, 500)}`);
  }
}

function extractJobId(payload: Record<string, unknown>): string | undefined {
  const result = payload.result as Record<string, unknown> | undefined;
  const structured = result?.structuredContent as Record<string, unknown> | undefined;
  for (const candidate of [structured?.job_id, structured?.jobId, result?.job_id, result?.jobId]) {
    if (typeof candidate === "string" && candidate) return candidate;
  }
  const text = collectResultText(payload);
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const candidate = parsed.job_id ?? parsed.jobId;
    if (typeof candidate === "string") return candidate;
  } catch {
    const match = text.match(/(?:job_id|jobId)["'\s:]+([A-Za-z0-9_-]+)/);
    if (match) return match[1];
  }
  return undefined;
}

function extractReference(payload: Record<string, unknown>): string | undefined {
  const haystack = `${collectResultText(payload)}\n${JSON.stringify(payload.result ?? {})}`;
  const urls = haystack.match(/https?:\/\/[^"'\s)\\]+/g) ?? [];
  return urls.find((url) => /\.(?:png|jpe?g|webp|gif|mp4|webm|mov|m4v|mp3|wav|m4a)(?:\?|$)/i.test(url))
    ?.replace(/[.,]+$/, "") ?? urls.at(-1)?.replace(/[.,]+$/, "");
}

function collectResultText(payload: Record<string, unknown>): string {
  const content = (payload.result as { content?: Array<{ text?: string }> } | undefined)?.content;
  if (!Array.isArray(content)) return "";
  return content.map((item) => item.text).filter(Boolean).join("\n");
}

function safeId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80) || "demo";
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function createLivepeerAdapter(): LivepeerAdapter {
  if (process.env.LIVEPEER_MODE === "real") {
    return new LivepeerMcpAdapter(process.env.LIVEPEER_MCP_URL ?? "", process.env.LIVEPEER_MCP_BEARER);
  }
  return new MockLivepeerAdapter();
}
