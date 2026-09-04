import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  BrainCircuit,
  Check,
  ChevronDown,
  Download,
  FileJson,
  Film,
  Image as ImageIcon,
  Layers3,
  LoaderCircle,
  Music2,
  Plus,
  ShieldCheck,
  Sparkles,
  X,
  Zap
} from "lucide-react";
import type {
  AspectRatio,
  ConfigStatus,
  CreateProjectRequest,
  DemoState,
  ImprovementMemoryKa,
  IterationSnapshot,
  MediaType,
  RunLedgerKa,
  WorkspaceState
} from "../shared/types";
import "./styles.css";

type AssetTab = "ledger" | "memory" | "changes";
type DataView = "visual" | "jsonld" | "rdf";

const emptyForm: CreateProjectRequest = {
  title: "",
  brief: "",
  mediaType: "image",
  aspectRatio: "16:9",
  successCriteria: ["The main subject is clear and immediately understandable."],
  avoid: ["unreadable text"],
  targetScore: 8
};

export function App() {
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null);
  const [config, setConfig] = useState<ConfigStatus | null>(null);
  const [selectedTry, setSelectedTry] = useState(0);
  const [assetTab, setAssetTab] = useState<AssetTab>("ledger");
  const [dataView, setDataView] = useState<DataView>("visual");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<CreateProjectRequest>(emptyForm);
  const [busy, setBusy] = useState<"baseline" | "memory" | "create" | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void Promise.all([getJson<WorkspaceState>("/api/state"), getJson<ConfigStatus>("/api/config")])
      .then(([nextWorkspace, nextConfig]) => {
        setWorkspace(nextWorkspace);
        setConfig(nextConfig);
      })
      .catch((cause) => setError(messageOf(cause)));
  }, []);

  const project = workspace?.projects.find((candidate) => candidate.projectId === workspace.activeProjectId)
    ?? workspace?.projects[0]
    ?? null;

  useEffect(() => {
    if (project) setSelectedTry(Math.max(0, project.attempts.length - 1));
  }, [project?.projectId, project?.attempts.length]);

  const snapshot = project?.iterationSnapshots[selectedTry] ?? null;
  const attempt = project?.attempts[selectedTry] ?? null;
  const previous = selectedTry > 0 ? project?.iterationSnapshots[selectedTry - 1] ?? null : null;

  async function selectProject(projectId: string) {
    if (!workspace || projectId === workspace.activeProjectId) return;
    setError("");
    try {
      setWorkspace(await postJson<WorkspaceState>(`/api/projects/${encodeURIComponent(projectId)}/select`, {}));
    } catch (cause) {
      setError(messageOf(cause));
    }
  }

  async function runAttempt(useDkgMemory: boolean) {
    if (!project) return;
    setBusy(useDkgMemory ? "memory" : "baseline");
    setError("");
    try {
      const result = await postJson<{ workspace: WorkspaceState }>(
        `/api/projects/${encodeURIComponent(project.projectId)}/attempts`,
        { useDkgMemory }
      );
      setWorkspace(result.workspace);
    } catch (cause) {
      setError(messageOf(cause));
      try {
        setWorkspace(await getJson<WorkspaceState>("/api/state"));
      } catch {
        // Keep the last safe client state if refresh also fails.
      }
    } finally {
      setBusy(null);
    }
  }

  async function createProject() {
    setBusy("create");
    setError("");
    try {
      const request = {
        ...form,
        successCriteria: form.successCriteria.map((item) => item.trim()).filter(Boolean),
        avoid: form.avoid.map((item) => item.trim()).filter(Boolean)
      };
      setWorkspace(await postJson<WorkspaceState>("/api/projects", request));
      setCreating(false);
      setForm(emptyForm);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(null);
    }
  }

  if (!workspace || !config || !project) {
    return (
      <main className="loading-screen">
        <span className="brand-mark"><Sparkles size={18} /></span>
        <LoaderCircle className="spin" />
        <p>{error || "Opening the iteration workspace..."}</p>
      </main>
    );
  }

  const score = attempt?.score ?? 0;
  const isRunning = busy === "baseline" || busy === "memory";

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Iteration Lab home">
          <span className="brand-mark"><Sparkles size={17} /></span>
          <span>
            <strong>Iteration Lab</strong>
            <small>Livepeer + OriginTrail</small>
          </span>
        </a>

        <div className="project-picker">
          <span>Project</span>
          <div className="select-wrap">
            <select value={project.projectId} onChange={(event) => void selectProject(event.target.value)}>
              {workspace.projects.map((candidate) => (
                <option key={candidate.projectId} value={candidate.projectId}>{candidate.target.title}</option>
              ))}
            </select>
            <ChevronDown size={15} />
          </div>
        </div>

        <div className="top-actions">
          <div className="integration-pills" aria-label="Integration status">
            <StatusPill label="Livepeer" active={config.livepeerConfigured} />
            <StatusPill label="DKG" active={config.dkgConfigured} />
            <StatusPill label="Blind judge" active={config.judgeConfigured} />
          </div>
          <a className="icon-button" href={`/api/receipt?projectId=${encodeURIComponent(project.projectId)}`} title="Export receipt">
            <Download size={17} />
          </a>
          <button className="primary compact" onClick={() => setCreating(true)}>
            <Plus size={17} /> New project
          </button>
        </div>
      </header>

      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button onClick={() => setError("")} aria-label="Dismiss"><X size={16} /></button>
        </div>
      )}

      <main className="workspace-grid">
        <aside className="iteration-rail">
          <div className="project-summary">
            <MediaGlyph type={project.target.mediaType} />
            <div>
              <p className="eyebrow">Active project</p>
              <h2>{project.target.title}</h2>
              <p>{mediaLabel(project.target.mediaType)} - {project.target.aspectRatio}
                {project.target.durationSeconds ? ` - ${project.target.durationSeconds}s` : ""}
              </p>
            </div>
          </div>

          <div className="rail-heading">
            <span>Iterations</span>
            <strong>{project.attempts.length}</strong>
          </div>

          <div className="timeline">
            {project.attempts.map((item, index) => (
              <button
                key={item.id}
                className={`timeline-item ${index === selectedTry ? "selected" : ""}`}
                onClick={() => setSelectedTry(index)}
              >
                <span className="timeline-node">{item.pass ? <Check size={13} /> : index + 1}</span>
                <span className="timeline-copy">
                  <strong>Try {item.attemptNumber}</strong>
                  <small>{item.usedDkgMemory ? "With DKG memory" : "Target only"}</small>
                </span>
                <span className={`score-mini ${item.pass ? "pass" : ""}`}>{item.score}/10</span>
              </button>
            ))}
            {!project.attempts.length && (
              <div className="empty-timeline">
                <span className="timeline-node">1</span>
                <p>Your first artifact will appear here.</p>
              </div>
            )}
          </div>

          <div className="rail-note">
            <ShieldCheck size={16} />
            <p><strong>Private by design</strong>DKG stores structured evidence and references, never raw media or secrets.</p>
          </div>
        </aside>

        <section className="artifact-stage">
          <div className="stage-header">
            <div>
              <p className="eyebrow">{attempt ? `Try ${attempt.attemptNumber}` : "Ready to begin"}</p>
              <h1>{project.target.title}</h1>
              <p className="brief">{project.target.brief}</p>
            </div>
            <div className="run-actions">
              {!project.attempts.length ? (
                <button className="primary" disabled={isRunning} onClick={() => void runAttempt(false)}>
                  {busy === "baseline" ? <LoaderCircle className="spin" size={17} /> : <Zap size={17} />}
                  Generate baseline
                </button>
              ) : (
                <button className="primary" disabled={isRunning} onClick={() => void runAttempt(true)}>
                  {busy === "memory" ? <LoaderCircle className="spin" size={17} /> : <BrainCircuit size={17} />}
                  Improve with DKG
                </button>
              )}
            </div>
          </div>

          <div className={`artifact-frame ${!attempt ? "empty" : ""}`}>
            {attempt ? (
              <MediaPreview type={attempt.mediaType} reference={attempt.outputReference} title={project.target.title} />
            ) : (
              <div className="empty-artifact">
                <span><MediaGlyph type={project.target.mediaType} /></span>
                <h3>Turn this brief into the first artifact</h3>
                <p>The Director will call Livepeer remotely, ask a blind judge to evaluate the output, then record both DKG assets.</p>
                <button className="primary" disabled={isRunning} onClick={() => void runAttempt(false)}>
                  {busy === "baseline" ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={17} />}
                  Generate Try 1
                </button>
              </div>
            )}
            {isRunning && (
              <div className="job-overlay">
                <LoaderCircle className="spin" />
                <strong>Remote media job in progress</strong>
                <span>Generation, blind evaluation, then DKG readback.</span>
              </div>
            )}
          </div>

          {attempt && (
            <div className="evaluation-card">
              <div className="score-orb">
                <strong>{score}</strong><span>/10</span>
              </div>
              <div>
                <div className="evaluation-title">
                  <p className="eyebrow">Blind evaluation</p>
                  <span className={attempt.pass ? "pass-label" : "iterate-label"}>
                    {attempt.pass ? "Target reached" : "Keep iterating"}
                  </span>
                </div>
                <p>{attempt.judgeOutputSummary}</p>
                <small>The judge received only the artifact and target criteria.</small>
              </div>
            </div>
          )}

          <details className="target-drawer">
            <summary>
              <span><Layers3 size={16} /> Target, criteria and generation details</span>
              <ChevronDown size={16} />
            </summary>
            <div className="drawer-grid">
              <div>
                <h4>Success criteria</h4>
                <ul>{project.target.successCriteria.map((item) => <li key={item}>{item}</li>)}</ul>
              </div>
              <div>
                <h4>Avoid</h4>
                <ul>{project.target.avoid.map((item) => <li key={item}>{item}</li>)}</ul>
              </div>
              <div>
                <h4>Generation</h4>
                <dl>
                  <div><dt>Mode</dt><dd>{mediaLabel(project.target.mediaType)}</dd></div>
                  <div><dt>Format</dt><dd>{project.target.aspectRatio}</dd></div>
                  <div><dt>Target</dt><dd>{project.target.targetScore}/10</dd></div>
                  {attempt && <div><dt>Capability</dt><dd>{attempt.generationCapability}</dd></div>}
                </dl>
              </div>
            </div>
          </details>
        </section>

        <aside className="dkg-inspector">
          <div className="inspector-header">
            <div>
              <p className="eyebrow">DKG asset observatory</p>
              <h2>{snapshot ? `State after Try ${snapshot.attemptNumber}` : "Waiting for Try 1"}</h2>
            </div>
            {snapshot && <DkgStatus snapshot={snapshot} />}
          </div>

          <div className="asset-tabs" role="tablist">
            <button className={assetTab === "ledger" ? "active" : ""} onClick={() => setAssetTab("ledger")}>Run Ledger</button>
            <button className={assetTab === "memory" ? "active" : ""} onClick={() => setAssetTab("memory")}>Improvement Memory</button>
            <button className={assetTab === "changes" ? "active" : ""} onClick={() => setAssetTab("changes")}>Changes</button>
          </div>

          {snapshot ? (
            <div className="inspector-body">
              {assetTab !== "changes" && (
                <div className="view-switch">
                  {(["visual", "jsonld", "rdf"] as DataView[]).map((view) => (
                    <button key={view} className={dataView === view ? "active" : ""} onClick={() => setDataView(view)}>
                      {view === "visual" ? "Visual" : view === "jsonld" ? "JSON-LD" : "RDF"}
                    </button>
                  ))}
                </div>
              )}
              {assetTab === "ledger" && (
                <AssetView
                  view={dataView}
                  json={snapshot.runLedger}
                  rdf={snapshot.runLedgerRdf}
                  visual={<LedgerVisual ledger={snapshot.runLedger} />}
                />
              )}
              {assetTab === "memory" && (
                <AssetView
                  view={dataView}
                  json={snapshot.improvementMemory}
                  rdf={snapshot.improvementMemoryRdf}
                  visual={<MemoryVisual memory={snapshot.improvementMemory} />}
                />
              )}
              {assetTab === "changes" && <ChangesView current={snapshot} previous={previous} />}
              <div className="asset-footnote">
                <FileJson size={15} />
                <span>{assetTab === "memory" ? shortId(snapshot.improvementMemory["@id"]) : shortId(snapshot.runLedger["@id"])}</span>
                <span>Immutable Try {snapshot.attemptNumber} snapshot</span>
              </div>
            </div>
          ) : (
            <div className="empty-inspector">
              <BrainCircuit size={28} />
              <h3>Two knowledge assets, every time</h3>
              <p>Run Ledger captures evidence. Improvement Memory carries only useful lessons into the next prompt.</p>
            </div>
          )}
        </aside>
      </main>

      {creating && (
        <ProjectModal
          form={form}
          setForm={setForm}
          profiles={config.mediaProfiles}
          busy={busy === "create"}
          onClose={() => setCreating(false)}
          onSubmit={() => void createProject()}
        />
      )}
    </div>
  );
}

function ProjectModal({
  form,
  setForm,
  profiles,
  busy,
  onClose,
  onSubmit
}: {
  form: CreateProjectRequest;
  setForm: (value: CreateProjectRequest) => void;
  profiles: ConfigStatus["mediaProfiles"];
  busy: boolean;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="project-modal" role="dialog" aria-modal="true" aria-labelledby="new-project-title">
        <div className="modal-header">
          <div><p className="eyebrow">New iteration</p><h2 id="new-project-title">What should the agent create?</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <div className="form-grid">
          <label className="full">Project name
            <input value={form.title} maxLength={100} placeholder="Aurora product launch" onChange={(event) => setForm({ ...form, title: event.target.value })} />
          </label>
          <label className="full">Desired output
            <textarea value={form.brief} maxLength={1200} rows={4} placeholder="Describe the artifact and the feeling it should create..." onChange={(event) => setForm({ ...form, brief: event.target.value })} />
          </label>

          <fieldset className="full media-choice">
            <legend>Output type</legend>
            <div>
              {profiles.map((profile) => (
                <button
                  type="button"
                  key={profile.mediaType}
                  className={form.mediaType === profile.mediaType ? "selected" : ""}
                  onClick={() => setForm({
                    ...form,
                    mediaType: profile.mediaType,
                    durationSeconds: profile.durationRequired ? Math.max(profile.mediaType === "video-audio" ? 6 : 1, form.durationSeconds ?? 6) : undefined
                  })}
                >
                  <MediaGlyph type={profile.mediaType} />
                  <strong>{profile.label}</strong>
                  <span>{profile.description}</span>
                  {form.mediaType === profile.mediaType && <Check size={15} />}
                </button>
              ))}
            </div>
          </fieldset>

          <label>Aspect ratio
            <select value={form.aspectRatio} onChange={(event) => setForm({ ...form, aspectRatio: event.target.value as AspectRatio })}>
              <option value="16:9">16:9 Landscape</option>
              <option value="9:16">9:16 Portrait</option>
              <option value="1:1">1:1 Square</option>
            </select>
          </label>
          {form.mediaType !== "image" && (
            <label>Duration
              <select value={form.durationSeconds ?? 6} onChange={(event) => setForm({ ...form, durationSeconds: Number(event.target.value) })}>
                {[6, 8, 10, 15, 20].map((duration) => <option key={duration} value={duration}>{duration} seconds</option>)}
              </select>
            </label>
          )}
          <label>Target score
            <select value={form.targetScore} onChange={(event) => setForm({ ...form, targetScore: Number(event.target.value) })}>
              {[7, 8, 9, 10].map((score) => <option key={score} value={score}>{score}/10</option>)}
            </select>
          </label>

          <ListField
            label="Success criteria"
            value={form.successCriteria}
            placeholder="One visible criterion per line"
            onChange={(value) => setForm({ ...form, successCriteria: value })}
          />
          <ListField
            label="Avoid"
            value={form.avoid}
            placeholder="One thing to avoid per line"
            onChange={(value) => setForm({ ...form, avoid: value })}
          />
        </div>

        <div className="modal-footer">
          <p><ShieldCheck size={15} /> Media is generated remotely. DKG stores structured evidence and references.</p>
          <div>
            <button className="secondary" onClick={onClose}>Cancel</button>
            <button className="primary" disabled={busy || !form.title.trim() || !form.brief.trim()} onClick={onSubmit}>
              {busy ? <LoaderCircle className="spin" size={17} /> : <ArrowRight size={17} />}
              Create project
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function ListField({ label, value, placeholder, onChange }: { label: string; value: string[]; placeholder: string; onChange: (value: string[]) => void }) {
  return (
    <label className="full">{label}
      <textarea
        rows={3}
        value={value.join("\n")}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value.split("\n"))}
      />
    </label>
  );
}

function AssetView({ view, json, rdf, visual }: { view: DataView; json: RunLedgerKa | ImprovementMemoryKa; rdf: string; visual: React.ReactNode }) {
  if (view === "jsonld") return <pre className="code-view">{JSON.stringify(json, null, 2)}</pre>;
  if (view === "rdf") return <pre className="code-view">{rdf}</pre>;
  return <>{visual}</>;
}

function LedgerVisual({ ledger }: { ledger: RunLedgerKa }) {
  const attempts = ledger["demo:hasAttempt"];
  return (
    <div className="ledger-list">
      <div className="metric-row"><span>Recorded attempts</span><strong>{attempts.length}</strong></div>
      {attempts.map((item, index) => (
        <div className="ledger-row" key={String(item["@id"] ?? index)}>
          <span className="ledger-index">{index + 1}</span>
          <div><strong>Try {String(item["demo:attemptNumber"])}</strong><small>{String(item["demo:usedDkgMemory"]) === "true" ? "DKG memory" : "Target only"}</small></div>
          <span className={item["demo:pass"] ? "pass-label" : "iterate-label"}>{String(item["demo:score"])}/10</span>
        </div>
      ))}
    </div>
  );
}

function MemoryVisual({ memory }: { memory: ImprovementMemoryKa }) {
  const failures = memory["demo:knownFailure"];
  const patterns = memory["demo:successfulPattern"];
  return (
    <div className="memory-stack">
      <div className="metric-row"><span>Latest score</span><strong>{memory["demo:latestScore"]}/10</strong></div>
      <MemorySection title="Known failures" items={failures} empty="None recorded for this state." tone="warm" />
      <MemorySection title="Successful patterns" items={patterns} empty="A passing pattern has not been confirmed yet." tone="cool" />
      <section className="strategy-card">
        <span><Sparkles size={14} /> Next prompt strategy</span>
        <p>{memory["demo:nextPromptStrategy"]}</p>
      </section>
    </div>
  );
}

function MemorySection({ title, items, empty, tone }: { title: string; items: string[]; empty: string; tone: string }) {
  return (
    <section className={`memory-section ${tone}`}>
      <h4>{title}</h4>
      {items.length ? <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul> : <p>{empty}</p>}
    </section>
  );
}

function ChangesView({ current, previous }: { current: IterationSnapshot; previous: IterationSnapshot | null }) {
  const currentMemory = current.improvementMemory;
  const previousMemory = previous?.improvementMemory;
  const addedFailures = difference(currentMemory["demo:knownFailure"], previousMemory?.["demo:knownFailure"] ?? []);
  const removedFailures = difference(previousMemory?.["demo:knownFailure"] ?? [], currentMemory["demo:knownFailure"]);
  const addedPatterns = difference(currentMemory["demo:successfulPattern"], previousMemory?.["demo:successfulPattern"] ?? []);
  return (
    <div className="changes-stack">
      <div className="change-hero">
        <span>{previous ? `Try ${previous.attemptNumber}` : "Start"}</span>
        <strong>{previousMemory?.["demo:latestScore"] ?? 0}/10</strong>
        <ArrowRight size={16} />
        <span>Try {current.attemptNumber}</span>
        <strong>{currentMemory["demo:latestScore"]}/10</strong>
      </div>
      <ChangeLine label="Run Ledger" value={`+${current.runLedger["demo:hasAttempt"].length - (previous?.runLedger["demo:hasAttempt"].length ?? 0)} attempt`} tone="added" />
      {addedFailures.map((item) => <ChangeLine key={item} label="Failure added" value={item} tone="added" />)}
      {removedFailures.map((item) => <ChangeLine key={item} label="Failure resolved" value={item} tone="removed" />)}
      {addedPatterns.map((item) => <ChangeLine key={item} label="Pattern confirmed" value={item} tone="added" />)}
      <ChangeLine label="Strategy updated" value={currentMemory["demo:nextPromptStrategy"]} tone="changed" />
      {!addedFailures.length && !removedFailures.length && !addedPatterns.length && previous && (
        <p className="no-change">The structured fields are stable; this Try still adds a new immutable run record.</p>
      )}
    </div>
  );
}

function ChangeLine({ label, value, tone }: { label: string; value: string; tone: string }) {
  return <div className={`change-line ${tone}`}><span>{label}</span><p>{value}</p></div>;
}

function DkgStatus({ snapshot }: { snapshot: IterationSnapshot }) {
  const shared = snapshot.dkg.state === "shared";
  return (
    <span className={`dkg-status ${shared ? "shared" : snapshot.dkg.state}`}>
      <span /> {shared ? `Shared - ${snapshot.dkg.layer}` : snapshot.dkg.state}
    </span>
  );
}

function MediaPreview({ type, reference, title }: { type: MediaType; reference: string; title: string }) {
  const url = mediaUrl(reference);
  if (!url) return <div className="reference-only"><Film size={28} /><p>Output reference</p><code>{reference}</code></div>;
  if (type === "image") return <img src={url} alt={`Generated artifact for ${title}`} />;
  return <video src={url} controls playsInline aria-label={`Generated artifact for ${title}`} />;
}

function MediaGlyph({ type }: { type: MediaType }) {
  if (type === "image") return <ImageIcon size={19} />;
  if (type === "video-audio") return <Music2 size={19} />;
  return <Film size={19} />;
}

function StatusPill({ label, active }: { label: string; active: boolean }) {
  return <span className={`status-pill ${active ? "active" : ""}`}><i />{label}</span>;
}

function mediaLabel(type: MediaType): string {
  return type === "video-audio" ? "Video + audio" : type[0].toUpperCase() + type.slice(1);
}

function mediaUrl(reference: string): string | null {
  if (/^https?:\/\//.test(reference)) return reference;
  if (/^[A-Za-z0-9.-]+\.[A-Za-z]{2,}\//.test(reference)) return `https://${reference}`;
  return null;
}

function shortId(value: string): string {
  const parts = value.split("/");
  return parts.slice(-2).join(" / ");
}

function difference(left: string[], right: string[]): string[] {
  return left.filter((item) => !right.includes(item));
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Request failed.");
  return payload as T;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Request failed.");
  return payload as T;
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Something went wrong.";
}
