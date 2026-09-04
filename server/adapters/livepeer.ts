import crypto from "node:crypto";
import type { MediaProfile, MediaType, TargetSpec } from "../../shared/types.js";

export interface GenerateMediaInput {
  executionId: string;
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
    capability: "pixverse-t2v",
    description: "Reliable short text-to-video generation.",
    durationRequired: true,
    nativeAudio: false
  },
  "video-audio": {
    mediaType: "video-audio",
    label: "Video + audio",
    capability: "pixverse-t2v + sonilo-v2m + ffmpeg-mux",
    description: "Video with adaptive audio, composed entirely through remote capabilities.",
    durationRequired: true,
    nativeAudio: false
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
    if (!this.endpoint) throw new Error("Livepeer generation is not configured.");
    await this.initialize();

    if (input.target.mediaType === "video-audio") {
      return this.generateVideoWithAudio(input);
    }

    const capability = input.target.mediaType === "image"
      ? process.env.LIVEPEER_IMAGE_CAPABILITY || process.env.LIVEPEER_CAPABILITY || profiles.image.capability
      : process.env.LIVEPEER_VIDEO_CAPABILITY || profiles.video.capability;
    const timeout = input.target.mediaType === "image"
      ? Number(process.env.LIVEPEER_IMAGE_TIMEOUT_SECONDS ?? 36)
      : Number(process.env.LIVEPEER_VIDEO_TIMEOUT_SECONDS ?? 600);
    const isAsync = input.target.mediaType === "video";
    const payload = await this.runCapability({
      capability,
      prompt: input.prompt,
      inputs: mediaInputs(input.target),
      timeout,
      async: isAsync,
      sessionId: input.target.id,
      idempotencyKey: stageKey(input, "media")
    });

    return outputFromPayload(payload, input.target.mediaType, capability);
  }

  private async generateVideoWithAudio(input: GenerateMediaInput): Promise<GenerateMediaOutput> {
    const videoCapability =
      process.env.LIVEPEER_VIDEO_AUDIO_VIDEO_CAPABILITY ||
      process.env.LIVEPEER_VIDEO_CAPABILITY ||
      profiles.video.capability;
    const audioCapability = process.env.LIVEPEER_VIDEO_AUDIO_AUDIO_CAPABILITY || "sonilo-v2m";
    const muxCapability = process.env.LIVEPEER_VIDEO_AUDIO_MUX_CAPABILITY || "ffmpeg-mux";

    const videoPayload = await this.runCapability({
      capability: videoCapability,
      prompt: input.prompt,
      inputs: mediaInputs(input.target),
      timeout: Number(process.env.LIVEPEER_VIDEO_TIMEOUT_SECONDS ?? 600),
      async: true,
      sessionId: input.target.id,
      idempotencyKey: stageKey(input, "video")
    });
    const videoReference = requireReference(videoPayload, "video");

    const audioPayload = await this.runCapability({
      capability: audioCapability,
      prompt: `Create a coherent, uplifting sound design for this video. Support the visible action and target mood. No speech unless the brief explicitly requires it. Target brief: ${input.target.brief}`,
      sourceUrl: videoReference,
      inputs: { duration: input.target.durationSeconds ?? 6 },
      timeout: Number(process.env.LIVEPEER_AUDIO_TIMEOUT_SECONDS ?? 400),
      async: false,
      sessionId: input.target.id,
      idempotencyKey: stageKey(input, "audio")
    });
    const audioReference = requireReference(audioPayload, "audio");

    const muxPayload = await this.runCapability({
      capability: muxCapability,
      inputs: { video_url: videoReference, audio_url: audioReference },
      timeout: 35,
      async: false,
      sessionId: input.target.id,
      idempotencyKey: stageKey(input, "mux")
    });

    return outputFromPayload(
      muxPayload,
      "video-audio",
      `${videoCapability} + ${audioCapability} + ${muxCapability}`
    );
  }

  private async runCapability({
    capability,
    prompt,
    sourceUrl,
    inputs,
    timeout,
    async,
    sessionId,
    idempotencyKey
  }: {
    capability: string;
    prompt?: string;
    sourceUrl?: string;
    inputs?: Record<string, unknown>;
    timeout: number;
    async: boolean;
    sessionId: string;
    idempotencyKey: string;
  }): Promise<Record<string, unknown>> {
    let payload = await this.callTool("run_capability", {
      capability,
      ...(prompt ? { prompt } : {}),
      ...(sourceUrl ? { source_url: sourceUrl } : {}),
      ...(inputs ? { inputs } : {}),
      timeout,
      async,
      persist: false,
      session_id: `iteration_lab_${safeId(sessionId)}`,
      idempotency_key: idempotencyKey
    });
    assertToolSuccess(payload, "Remote media capability");

    if (async) {
      const jobId = extractJobId(payload);
      if (!jobId) throw new Error("The remote media service accepted a job without a job id.");
      payload = await this.waitForJob(jobId, timeout);
    }
    return payload;
  }

  private async waitForJob(jobId: string, timeoutSeconds: number): Promise<Record<string, unknown>> {
    const deadline = Date.now() + timeoutSeconds * 1000;
    while (Date.now() < deadline) {
      const payload = await this.callTool("get_create_media", { job_id: jobId });
      assertToolSuccess(payload, "Remote media job");
      const status = extractStatus(payload);
      if (["failed", "cancelled", "error"].includes(status)) {
        throw new Error("The remote media job failed before producing an output.");
      }
      if (extractReference(payload) && ["done", "completed", "complete", "succeeded", "success", "ready", ""].includes(status)) {
        return payload;
      }
      await delay(5000);
    }
    throw new Error("The remote media job timed out before producing an output.");
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return;
    const payload = await this.callJsonRpc("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "livepeer-dkg-iteration-lab", version: "0.2.0" }
    });
    if (payload.error) throw new Error("Livepeer MCP initialization failed.");
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
    if (!response.ok) throw new Error(`Livepeer request failed with status ${response.status}.`);
    return JSON.parse(text) as Record<string, unknown>;
  }
}

function mediaInputs(target: TargetSpec): Record<string, unknown> {
  if (target.mediaType === "image") return { aspect_ratio: target.aspectRatio };
  return {
    duration: Math.max(1, Math.min(15, target.durationSeconds ?? 6)),
    aspect_ratio: target.aspectRatio
  };
}

function stageKey(input: GenerateMediaInput, stage: string): string {
  const seed = crypto
    .createHash("sha256")
    .update(`${input.target.id}:${input.attemptNumber}:${input.executionId}:${input.prompt}:${stage}`)
    .digest("hex")
    .slice(0, 36);
  return `il_${stage}_${seed}`;
}

function outputFromPayload(
  payload: Record<string, unknown>,
  mediaType: MediaType,
  capability: string
): GenerateMediaOutput {
  const outputReference = requireReference(payload, "media");
  const resultText = collectResultText(payload) || JSON.stringify(payload.result ?? payload);
  return {
    outputReference,
    outputHash: crypto.createHash("sha256").update(resultText).digest("hex"),
    mediaType,
    capability
  };
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

function extractStatus(payload: Record<string, unknown>): string {
  const result = payload.result as Record<string, unknown> | undefined;
  const structured = result?.structuredContent as Record<string, unknown> | undefined;
  for (const candidate of [structured?.status, result?.status]) {
    if (typeof candidate === "string") return candidate.toLowerCase();
  }
  const text = collectResultText(payload);
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return typeof parsed.status === "string" ? parsed.status.toLowerCase() : "";
  } catch {
    return text.match(/status["'\s:]+([A-Za-z_-]+)/i)?.[1]?.toLowerCase() ?? "";
  }
}

function requireReference(payload: Record<string, unknown>, label: string): string {
  const reference = extractReference(payload);
  if (!reference) throw new Error(`The remote ${label} capability completed without an output reference.`);
  return reference;
}

function extractReference(payload: Record<string, unknown>): string | undefined {
  const result = payload.result as Record<string, unknown> | undefined;
  const structured = result?.structuredContent as Record<string, unknown> | undefined;
  for (const candidate of [structured?.url, result?.url]) {
    if (typeof candidate === "string" && candidate.startsWith("http")) return candidate;
  }
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
