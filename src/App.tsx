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
  Network,
  Plus,
  ShieldCheck,
  Sparkles,
  X,
  Zap
} from "lucide-react";
import type {
  AspectRatio,
  AttemptJob,
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

type AssetTab = "graph" | "ledger" | "memory" | "changes";
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
  const [assetTab, setAssetTab] = useState<AssetTab>("graph");
  const [dataView, setDataView] = useState<DataView>("visual");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<CreateProjectRequest>(emptyForm);
  const [busy, setBusy] = useState<"baseline" | "memory" | "create" | null>(null);
  const [error, setError] = useState("");
  const [pendingProjectId, setPendingProjectId] = useState<string | null>(null);
  const [userDirection, setUserDirection] = useState("");

  useEffect(() => {
    void Promise.all([getJson<WorkspaceState>("/api/state"), getJson<ConfigStatus>("/api/config")])
      .then(([nextWorkspace, nextConfig]) => {
        setWorkspace(nextWorkspace);
        setConfig(nextConfig);
      })
      .catch((cause) => setError(messageOf(cause)));
  }, []);

  const hasActiveJobs = Boolean(workspace?.projects.some((candidate) =>
    candidate.attemptJobs.some((job) => isActiveJob(job))
  ));
  const attemptRequestPending = busy === "baseline" || busy === "memory";

  useEffect(() => {
    if (!hasActiveJobs && !attemptRequestPending) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const next = await getJson<WorkspaceState>("/api/state");
        if (!cancelled) setWorkspace(next);
      } catch {
        // The original request remains authoritative; the next poll can recover.
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1500);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [hasActiveJobs, attemptRequestPending]);

  const project = workspace?.projects.find((candidate) => candidate.projectId === workspace.activeProjectId)
    ?? workspace?.projects[0]
    ?? null;

  useEffect(() => {
    if (project) setSelectedTry(Math.max(0, project.attempts.length - 1));
  }, [project?.projectId, project?.attempts.length]);

  useEffect(() => {
    setUserDirection("");
  }, [project?.projectId]);

  const snapshot = project?.iterationSnapshots[selectedTry] ?? null;
  const attempt = project?.attempts[selectedTry] ?? null;
  const previous = selectedTry > 0 ? project?.iterationSnapshots[selectedTry - 1] ?? null : null;
  const selectedAttemptJob = attempt
    ? [...(project?.attemptJobs ?? [])].reverse().find((job) => job.attemptNumber === attempt.attemptNumber) ?? null
    : null;

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
    const projectId = project.projectId;
    setPendingProjectId(projectId);
    setBusy(useDkgMemory ? "memory" : "baseline");
    setError("");
    try {
      const result = await postJson<{ workspace: WorkspaceState }>(
        `/api/projects/${encodeURIComponent(projectId)}/attempts`,
        { useDkgMemory, userDirection }
      );
      setWorkspace(result.workspace);
      setUserDirection("");
    } catch (cause) {
      setError(messageOf(cause));
      try {
        setWorkspace(await getJson<WorkspaceState>("/api/state"));
      } catch {
        // Keep the last safe client state if refresh also fails.
      }
    } finally {
      setBusy(null);
      setPendingProjectId(null);
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
  const activeJob = [...project.attemptJobs].reverse().find(isActiveJob);
  const latestJob = project.attemptJobs[project.attemptJobs.length - 1] ?? null;
  const latestFailedJob = latestJob?.status === "failed" ? latestJob : null;
  const pendingHere = attemptRequestPending && pendingProjectId === project.projectId;
  const isProjectRunning = Boolean(activeJob) || pendingHere;
  const visibleJobs = project.attemptJobs.filter((job) =>
    isActiveJob(job) ||
    (job.status === "failed" && (job.phase === "dkg" ||
      !project.attempts.some((attemptRecord) => attemptRecord.attemptNumber === job.attemptNumber)))
  );
  const isRunning = hasActiveJobs || attemptRequestPending;
  const nextAttemptNumber = Math.max(
    0,
    ...project.attempts.map((item) => item.attemptNumber),
    ...project.attemptJobs.filter(isActiveJob).map((job) => job.attemptNumber)
  ) + 1;

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
                <option key={candidate.projectId} value={candidate.projectId}>
                  {candidate.target.title}
                  {candidate.attemptJobs.some(isActiveJob) ? " - running" : latestJobStatus(candidate.attemptJobs) === "failed" ? " - needs attention" : ""}
                </option>
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
            <strong>{nextAttemptNumber - 1}</strong>
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
                  <small>{attemptMemoryLabel(item, project.attemptJobs)}</small>
                </span>
                <span className={`score-mini ${item.pass ? "pass" : ""}`}>{item.score}/10</span>
              </button>
            ))}
            {visibleJobs.map((job) => (
              <div className={`timeline-item job ${job.status}`} key={job.id}>
                <span className="timeline-node">
                  {isActiveJob(job) ? <LoaderCircle className="spin" size={13} /> : <X size={13} />}
                </span>
                <span className="timeline-copy">
                  <strong>Try {job.attemptNumber}</strong>
                  <small>{job.status === "failed" ? job.error : jobStatusLabel(job)}</small>
                </span>
                <span className="score-mini">{job.status === "failed" ? "Failed" : "Live"}</span>
              </div>
            ))}
            {!project.attempts.length && !project.attemptJobs.length && (
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
          </div>

          <section className="try-composer" aria-labelledby="try-composer-title">
            <div className="composer-topline">
              <div>
                <p className="eyebrow">Compose Try {nextAttemptNumber}</p>
                <h3 id="try-composer-title">Guide the Director</h3>
              </div>
              <div className="composition-path" aria-label="Prompt composition path">
                <span>Target</span>
                <ArrowRight size={12} />
                {project.attempts.length > 0 && (
                  <>
                    <span className="memory-chip">DKG memory</span>
                    <ArrowRight size={12} />
                  </>
                )}
                <span className={userDirection.trim() ? "active" : ""}>Your direction</span>
                <ArrowRight size={12} />
                <span className="director-chip">Director prompt</span>
              </div>
            </div>
            <label htmlFor="user-direction">Your direction <span>optional</span></label>
            <textarea
              id="user-direction"
              value={userDirection}
              maxLength={1200}
              rows={3}
              disabled={isRunning}
              placeholder="Add a specific creative choice, correction, or constraint for this Try..."
              onChange={(event) => setUserDirection(event.target.value)}
            />
            <div className="composer-footer">
              <small>The Director combines this with the target and sanitized graph observations. Your text is not copied into shared DKG assets or shown to the blind judge.</small>
              <button
                className="primary"
                disabled={isRunning}
                onClick={() => void runAttempt(project.attempts.length > 0)}
              >
                {isProjectRunning
                  ? <LoaderCircle className="spin" size={17} />
                  : project.attempts.length
                    ? <BrainCircuit size={17} />
                    : <Zap size={17} />}
                {isProjectRunning ? "Running..." : `Generate Try ${nextAttemptNumber}`}
              </button>
            </div>
          </section>

          {latestFailedJob && !activeJob && (
            <div className="job-failure-notice" role="status">
              <span><X size={15} /></span>
              <div>
                <strong>Try {latestFailedJob.attemptNumber} stopped during {jobStatusLabel(latestFailedJob).toLowerCase()}</strong>
                <p>{latestFailedJob.error ?? "The run did not complete."}</p>
              </div>
            </div>
          )}

          <div className={`artifact-frame ${!attempt ? "empty" : ""}`}>
            {attempt ? (
              <MediaPreview type={attempt.mediaType} reference={attempt.outputReference} title={project.target.title} />
            ) : (
              <div className="empty-artifact">
                <span><MediaGlyph type={project.target.mediaType} /></span>
                <h3>Turn this brief into the first artifact</h3>
                <p>Add an optional direction above, then let the Director compose and run the complete prompt.</p>
              </div>
            )}
            {isProjectRunning && (
              <div className="job-overlay">
                <LoaderCircle className="spin" />
                <strong>Try {activeJob?.attemptNumber ?? nextAttemptNumber} - {activeJob ? jobStatusLabel(activeJob) : "Starting"}</strong>
                <span>This job stays attached to {project.target.title}, even if you open another project.</span>
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

          {attempt && (
            <div className="prompt-trace-card">
              <div className="prompt-trace-heading">
                <span><BrainCircuit size={15} /> Director prompt for Try {attempt.attemptNumber}</span>
                <span className={`prompt-integrity ${attempt.promptTextVerified ? "verified" : "recovered"}`}>
                  {attempt.promptTextVerified ? "Fingerprint verified" : "Historical reconstruction"}
                </span>
              </div>
              <div className="prompt-provenance">
                <span>Target</span>
                {attempt.usedDkgMemory && <span>+ {attempt.memoryUsed.length} DKG observations</span>}
                {attempt.userDirectionApplied && <span>+ Your direction</span>}
                <ArrowRight size={13} />
                <strong>Final generation prompt</strong>
              </div>
              <pre className="prompt-text">{attempt.promptText}</pre>
              <div className="prompt-trace-meta">
                <code>{attempt.promptHash}</code>
                <small>
                  {attempt.promptTextVerified
                    ? "This private prompt matches the fingerprint stored with the run."
                    : "This older run predates private prompt storage; the displayed reconstruction does not match its historical fingerprint."}
                  {" "}Only the fingerprint, structured evidence, and relationships are shared to DKG.
                </small>
              </div>
              {attempt.usedDkgMemory && (
                <details className="memory-used">
                  <summary>View the sanitized graph observations used</summary>
                  <ul>{attempt.memoryUsed.map((item) => <li key={item}>{item}</li>)}</ul>
                </details>
              )}
              {!attempt.usedDkgMemory && selectedAttemptJob?.useDkgMemory && (
                <p className="memory-warning">DKG memory was requested, but no reusable observation was returned for this Try.</p>
              )}
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
            <button className={assetTab === "graph" ? "active" : ""} onClick={() => setAssetTab("graph")}>Graph</button>
            <button className={assetTab === "ledger" ? "active" : ""} onClick={() => setAssetTab("ledger")}>Run Ledger</button>
            <button className={assetTab === "memory" ? "active" : ""} onClick={() => setAssetTab("memory")}>Improvement Memory</button>
            <button className={assetTab === "changes" ? "active" : ""} onClick={() => setAssetTab("changes")}>Changes</button>
          </div>

          {snapshot ? (
            <div className="inspector-body">
              {(assetTab === "ledger" || assetTab === "memory") && (
                <div className="view-switch">
                  {(["visual", "jsonld", "rdf"] as DataView[]).map((view) => (
                    <button key={view} className={dataView === view ? "active" : ""} onClick={() => setDataView(view)}>
                      {view === "visual" ? "Visual" : view === "jsonld" ? "JSON-LD" : "RDF"}
                    </button>
                  ))}
                </div>
              )}
              {assetTab === "graph" && <KnowledgeGraphVisual snapshot={snapshot} />}
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
function KnowledgeGraphVisual({ snapshot }: { snapshot: IterationSnapshot }) {
  const runs = snapshot.runLedger["demo:hasAttempt"];
  const observations = snapshot.improvementMemory["demo:hasObservation"];
  const strategy = snapshot.improvementMemory["demo:hasStrategy"];

  return (
    <div className="kg-visual">
      <div className="kg-heading">
        <span><Network size={15} /> RDF relationship map</span>
        <small>{runs.length} runs - {observations.length} observations</small>
      </div>

      <GraphNode tone="target" kicker="Entity" title="Target" meta={shortId(snapshot.runLedger["demo:targetId"])} />
      <GraphEdge label="is tracked by" />
      <GraphNode tone="ledger" kicker="Knowledge Asset" title="Run Ledger" meta={shortId(snapshot.runLedger["@id"])} />

      {runs.map((run, index) => {
        const artifact = (run["demo:generatedArtifact"] ?? {}) as Record<string, unknown>;
        const evaluation = (run["demo:hasEvaluation"] ?? {}) as Record<string, unknown>;
        const memoryInputs = Array.isArray(run["demo:usedMemoryObservation"])
          ? run["demo:usedMemoryObservation"] as Array<Record<string, unknown>>
          : [];
        return (
          <section className="kg-run" key={String(run["@id"] ?? index)}>
            <GraphEdge label="hasAttempt" />
            <GraphNode
              tone="run"
              kicker="GenerationAttempt"
              title={`Try ${String(run["demo:attemptNumber"])}`}
              meta={`${String(run["demo:mediaType"])} - prompt ${String(run["demo:promptHash"]).slice(0, 9)}`}
            />
            <div className="kg-branches">
              <div>
                <GraphEdge label="generatedArtifact" compact />
                <GraphNode
                  tone="artifact"
                  kicker="MediaArtifact"
                  title="Output"
                  meta={shortId(String(artifact["@id"] ?? ""))}
                  compact
                />
              </div>
              <div>
                <GraphEdge label="hasEvaluation" compact />
                <GraphNode
                  tone="evaluation"
                  kicker="BlindEvaluation"
                  title={`${String(evaluation["demo:score"] ?? run["demo:score"])}/10`}
                  meta={String(evaluation["demo:pass"] ?? run["demo:pass"]) === "true" ? "target reached" : "iterate"}
                  compact
                />
              </div>
            </div>
            {memoryInputs.length > 0 && (
              <div className="kg-memory-link">
                <GraphEdge label={`usedMemoryObservation x${memoryInputs.length}`} compact />
                <span>Only content fingerprints cross this run link.</span>
              </div>
            )}
          </section>
        );
      })}

      <GraphEdge label="updates" />
      <GraphNode
        tone="memory"
        kicker="Knowledge Asset"
        title="Improvement Memory"
        meta={shortId(snapshot.improvementMemory["@id"])}
      />

      <div className="kg-observations">
        {observations.map((observation, index) => {
          const from = observation["demo:fromAttempt"]["@id"].split("/").at(-1) ?? "?";
          return (
            <div key={observation["@id"]}>
              <GraphEdge label="hasObservation" compact />
              <GraphNode
                tone="observation"
                kicker={`MemoryObservation - ${observation["demo:category"]}`}
                title={observation["demo:body"]}
                meta={`fromAttempt Try ${from} - ${observation["demo:relation"]}${observation["demo:criterionIndex"] !== undefined ? ` - criterion ${observation["demo:criterionIndex"] + 1}` : ""}`}
                compact
              />
            </div>
          );
        })}
      </div>

      <GraphEdge label="hasStrategy" compact />
      <GraphNode
        tone="strategy"
        kicker="PromptStrategy"
        title={strategy["demo:body"]}
        meta={strategy["demo:fromAttempt"] ? `fromAttempt Try ${strategy["demo:fromAttempt"]["@id"].split("/").at(-1)}` : "initial strategy"}
        compact
      />
      <p className="kg-privacy"><ShieldCheck size={13} /> RDF contains typed relationships and sanitized evidence. Full prompts remain in private run state.</p>
    </div>
  );
}

function GraphNode({
  tone,
  kicker,
  title,
  meta,
  compact = false
}: {
  tone: string;
  kicker: string;
  title: string;
  meta: string;
  compact?: boolean;
}) {
  return (
    <div className={`graph-node ${tone} ${compact ? "compact" : ""}`}>
      <span>{kicker}</span>
      <strong>{title}</strong>
      <small>{meta}</small>
    </div>
  );
}

function GraphEdge({ label, compact = false }: { label: string; compact?: boolean }) {
  return (
    <div className={`graph-edge ${compact ? "compact" : ""}`}>
      <i />
      <span>{label}</span>
      <ArrowRight size={11} />
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

function attemptMemoryLabel(attempt: DemoState["attempts"][number], jobs: AttemptJob[]): string {
  if (attempt.usedDkgMemory) return "With DKG memory";
  const job = [...jobs].reverse().find((candidate) => candidate.attemptNumber === attempt.attemptNumber);
  return job?.useDkgMemory ? "DKG returned no memory" : "Target only";
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Something went wrong.";
}

function isActiveJob(job: AttemptJob): boolean {
  return job.status !== "completed" && job.status !== "failed";
}

function latestJobStatus(jobs: AttemptJob[]): AttemptJob["status"] | null {
  return jobs[jobs.length - 1]?.status ?? null;
}

function jobStatusLabel(job: AttemptJob): string {
  if (job.status === "failed") {
    if (job.phase === "memory") return "DKG memory read";
    if (job.phase === "generation") return "remote generation";
    if (job.phase === "judging") return "blind evaluation";
    if (job.phase === "dkg") return "DKG sharing";
    return "run";
  }
  if (job.phase === "memory") return "Reading DKG memory";
  if (job.phase === "generation") return "Generating remotely";
  if (job.phase === "judging") return "Blind evaluation";
  if (job.phase === "dkg") return "Sharing DKG assets";
  return "Complete";
}
