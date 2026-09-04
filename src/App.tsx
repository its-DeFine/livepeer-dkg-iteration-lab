import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  BrainCircuit,
  Check,
  ChevronDown,
  Download,
  Copy,
  ExternalLink,
  Columns2,
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
import { KnowledgeGraph } from "./KnowledgeGraph";
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
  const [directions, setDirections] = useState<Record<string, string>>({});
  const [activeProjectId, setActiveProjectId] = useState("");
  const [creatingBusy, setCreatingBusy] = useState(false);
  const [compare, setCompare] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void Promise.all([getJson<WorkspaceState>("/api/state"), getJson<ConfigStatus>("/api/config")])
      .then(([nextWorkspace, nextConfig]) => {
        setWorkspace(nextWorkspace);
        setActiveProjectId(nextWorkspace.activeProjectId);
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

  const project = workspace?.projects.find((candidate) => candidate.projectId === (activeProjectId || workspace.activeProjectId))
    ?? workspace?.projects[0]
    ?? null;

  useEffect(() => {
    if (project) setSelectedTry(Math.max(0, project.attempts.length - 1));
  }, [project?.projectId, project?.attempts.length]);

  const userDirection = directions[project?.projectId ?? ""] ?? "";
  function setUserDirection(value: string) {
    if (project) setDirections((current) => ({ ...current, [project.projectId]: value }));
  }
  useEffect(() => { setCompare(false); setCopied(false); }, [project?.projectId, selectedTry]);

  const snapshot = project?.iterationSnapshots[selectedTry] ?? null;
  const attempt = project?.attempts[selectedTry] ?? null;
  const previous = selectedTry > 0 ? project?.iterationSnapshots[selectedTry - 1] ?? null : null;
  const selectedAttemptJob = attempt
    ? [...(project?.attemptJobs ?? [])].reverse().find((job) => job.attemptNumber === attempt.attemptNumber) ?? null
    : null;

  async function selectProject(projectId: string) {
    if (!workspace || projectId === project?.projectId) return;
    setActiveProjectId(projectId);
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
      setDirections((current) => ({ ...current, [projectId]: "" }));
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
    setCreatingBusy(true);
    setError("");
    try {
      const request = {
        ...form,
        successCriteria: form.successCriteria.map((item) => item.trim()).filter(Boolean),
        avoid: form.avoid.map((item) => item.trim()).filter(Boolean)
      };
      const created = await postJson<WorkspaceState>("/api/projects", request);
      setWorkspace(created);
      setActiveProjectId(created.activeProjectId);
      setCreating(false);
      setForm(emptyForm);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setCreatingBusy(false);
    }
  }

  if (!workspace || !config || !project) {
    return (
      <main className="loading-screen">
        <span className="brand-mark"><Sparkles size={18} /></span>
        <LoaderCircle className="spin" />
        <p>{error || "Opening the iteration workspace..."}</p>
        {error && <button className="primary" onClick={() => window.location.reload()}>Try again</button>}
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
            <StatusPill label={config.livepeerMode === "real" ? "Livepeer · remote" : "Livepeer · demo"} active={config.livepeerConfigured} />
            <StatusPill label={config.dkgMode === "cli" ? "DKG · edge" : "Memory · file demo"} active={config.dkgConfigured} />
            <StatusPill label={config.judgeMode === "real" ? "Judge · remote" : "Judge · demo"} active={config.judgeConfigured} />
          </div>
          <a className="icon-button" href={`/api/receipt?projectId=${encodeURIComponent(project.projectId)}`} title="Export receipt" aria-label="Export project receipt" target="_blank" rel="noreferrer">
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
            <p><strong>The learning loop</strong>Each Try adds evidence. The next Try reads reusable observations from memory.</p>
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




          <div className="workshop-flow" aria-label="How an iteration works">
            <span><b>01</b> Direct</span><ArrowRight size={14} /><span><b>02</b> Generate</span><ArrowRight size={14} /><span><b>03</b> Evaluate</span><ArrowRight size={14} /><span><b>04</b> Remember</span>
          </div>
          {latestFailedJob && !activeJob && (
            <div className="job-failure-notice" role="status">
              <span><X size={15} /></span>
              <div>
                <strong>Try {latestFailedJob.attemptNumber} stopped during {jobStatusLabel(latestFailedJob).toLowerCase()}</strong>
                <p>{latestFailedJob.error ?? "The run did not complete."}</p>
              </div>
            </div>
          )}


          {attempt && (
            <div className="artifact-toolbar">
              <div><span className="eyebrow">Selected artifact</span><strong>Try {attempt.attemptNumber} <small>{mediaLabel(attempt.mediaType)}</small></strong></div>
              <div>
                {selectedTry > 0 && <button className={compare ? "secondary selected" : "secondary"} aria-pressed={compare} onClick={() => setCompare(!compare)}><Columns2 size={16} />{compare ? "Single view" : "Compare previous"}</button>}
                {mediaUrl(attempt.outputReference) && <a className="secondary" href={mediaUrl(attempt.outputReference)!} target="_blank" rel="noreferrer"><ExternalLink size={15} />Open output</a>}
              </div>
            </div>
          )}
          <div className={compare && selectedTry > 0 ? "artifact-comparison" : ""}>
            {compare && selectedTry > 0 && (
              <div>
                <p className="comparison-label">Try {project.attempts[selectedTry - 1].attemptNumber} <span>{project.attempts[selectedTry - 1].score}/10</span></p>
                <div className="artifact-frame"><MediaPreview type={project.attempts[selectedTry - 1].mediaType} reference={project.attempts[selectedTry - 1].outputReference} title="Previous Try" /></div>
              </div>
            )}
            <div>
              {compare && attempt && <p className="comparison-label">Try {attempt.attemptNumber} <span>{attempt.score}/10</span></p>}
          <div className={`artifact-frame ${!attempt ? "empty" : ""}`}>
            {attempt ? (
              <MediaPreview type={attempt.mediaType} reference={attempt.outputReference} title={project.target.title} />
            ) : (
              <div className="empty-artifact">
                <span><MediaGlyph type={project.target.mediaType} /></span>
                <h3>Turn this brief into the first artifact</h3>
                <p>Add your direction below, then generate your first Try. Its evaluation and memory will appear alongside it.</p>
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


            </div>
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
                <small>Independent evaluation · artifact and target criteria only. Scores are model judgments, not a guarantee of improvement.</small>
              </div>
            </div>
          )}

          <section className="try-composer" aria-labelledby="try-composer-title">
            <div className="composer-topline">
              <div>
                <p className="eyebrow">Compose Try {nextAttemptNumber}</p>
                <h3 id="try-composer-title">{project.attempts.length ? "What should improve next?" : "Create your first artifact"}</h3>
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
              <small>The Director combines this with the target and sanitized graph observations. The full prompt stays in this workspace; the judge evaluates the artifact against the target.</small>
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

          {attempt && (
            <div className="prompt-trace-card">
              <div className="prompt-trace-heading">
                <span><BrainCircuit size={15} /> Director prompt for Try {attempt.attemptNumber}</span>
                <span className={`prompt-integrity ${attempt.promptTextVerified ? "verified" : "recovered"}`}>
                  {attempt.promptTextVerified ? "Fingerprint verified" : "Historical · unverified"}
                </span>
              </div>
              <div className="prompt-provenance">
                <span>Target</span>
                {attempt.usedDkgMemory && <span>+ {attempt.memoryUsed.length} DKG observations</span>}
                {attempt.userDirectionApplied && <span>+ Your direction</span>}
                <ArrowRight size={13} />
                <strong>Final generation prompt</strong>
              </div>
              <details className="prompt-disclosure">
                <summary>Read the full generation prompt <ChevronDown size={15} /></summary>
                <button className="copy-prompt secondary" onClick={async () => { try { await navigator.clipboard.writeText(attempt.promptText); setCopied(true); } catch { setError("Copy is unavailable. Select the prompt text to copy it."); } }}><Copy size={14} />{copied ? "Copied" : "Copy prompt"}</button>
                <pre className="prompt-text">{attempt.promptText}</pre>
              </details>
              <div className="prompt-trace-meta">
                <code>{attempt.promptHash}</code>
                <small>
                  {attempt.promptTextVerified
                    ? "This private prompt matches the fingerprint stored with the run."
                    : "This historical prompt cannot be verified against an originally stored prompt and fingerprint pair. It may be reconstructed."}
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

          <div className="asset-tabs" role="tablist" aria-label="Knowledge asset views">
            <button role="tab" aria-selected={assetTab === "graph"} className={assetTab === "graph" ? "active" : ""} onClick={() => setAssetTab("graph")}>Graph</button>
            <button role="tab" aria-selected={assetTab === "ledger"} className={assetTab === "ledger" ? "active" : ""} onClick={() => setAssetTab("ledger")}>Run Ledger</button>
            <button role="tab" aria-selected={assetTab === "memory"} className={assetTab === "memory" ? "active" : ""} onClick={() => setAssetTab("memory")}>Memory</button>
            <button role="tab" aria-selected={assetTab === "changes"} className={assetTab === "changes" ? "active" : ""} onClick={() => setAssetTab("changes")}>Changes</button>
          </div>

          {snapshot ? (
            <div className="inspector-body" role="tabpanel">
              {(assetTab === "ledger" || assetTab === "memory") && (
                <div className="view-switch">
                  {(["visual", "jsonld", "rdf"] as DataView[]).map((view) => (
                    <button key={view} className={dataView === view ? "active" : ""} onClick={() => setDataView(view)}>
                      {view === "visual" ? "Visual" : view === "jsonld" ? "JSON-LD" : "RDF"}
                    </button>
                  ))}
                </div>
              )}
              {assetTab === "graph" && <KnowledgeGraph snapshot={snapshot} />}
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
                <span>Evidence captured after Try {snapshot.attemptNumber}</span>
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
          busy={creatingBusy}
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
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLInputElement>("input")?.focus();
    return () => previous?.focus();
  }, []);
  return (
    <div className="modal-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section ref={dialog} className="project-modal" onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) onClose();
        if (event.key === "Tab") {
          const items = Array.from(dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input, textarea, select") ?? []);
          const first = items[0], last = items.at(-1);
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }} role="dialog" aria-modal="true" aria-labelledby="new-project-title">
        <div className="modal-header">
          <div><p className="eyebrow">New iteration</p><h2 id="new-project-title">What should the agent create?</h2></div>
          <button className="icon-button" disabled={busy} onClick={onClose} aria-label="Close"><X size={18} /></button>
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
            <button className="secondary" disabled={busy} onClick={onClose}>Cancel</button>
            <button className="primary" disabled={busy || !form.title.trim() || !form.brief.trim() || !form.successCriteria.some((item) => item.trim())} onClick={onSubmit}>
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
      {removedFailures.map((item) => <ChangeLine key={item} label="Failure no longer listed" value={item} tone="removed" />)}
      {addedPatterns.map((item) => <ChangeLine key={item} label="Observation added" value={item} tone="added" />)}
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
      <span /> {snapshot.dkg.layer === "local" ? (shared ? "Local file demo" : "Recorded locally") : shared ? `Shared · ${snapshot.dkg.layer}` : snapshot.dkg.state}
    </span>
  );
}

function MediaPreview({ type, reference, title }: { type: MediaType; reference: string; title: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [reference]);
  const url = mediaUrl(reference);
  if (!url || failed) return <div className="reference-only"><Film size={28} /><p>{failed ? "Preview unavailable" : "Output reference"}</p><small>{failed ? "The media link may have expired or the format may not play in this browser." : "This run returned a reference without a browser preview."}</small>{url && <a href={url} className="secondary" target="_blank" rel="noreferrer">Open original output <ExternalLink size={14} /></a>}</div>;
  if (type === "image") return <img src={url} alt={`Generated artifact for ${title}`} onError={() => setFailed(true)} />;
  return <video key={url} src={url} controls playsInline preload="metadata" onError={() => setFailed(true)} aria-label={`Generated artifact for ${title}`} />;
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
