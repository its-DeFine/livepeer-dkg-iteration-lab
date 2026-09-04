import {
  Archive,
  Brain,
  CheckCircle2,
  Database,
  Download,
  ExternalLink,
  GitBranch,
  History,
  Layers3,
  Loader2,
  Network,
  Play,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
  Target,
  Workflow
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type {
  AttemptRecord,
  ConfigStatus,
  DemoState,
  ImprovementMemoryKa,
  RunAttemptResponse,
  RunLedgerKa
} from "../shared/types";

const stageCards = [
  {
    icon: <Target size={18} />,
    label: "1. Target",
    title: "Define the desired output",
    body: "The Director starts from a product brief, success criteria, and explicit avoid rules."
  },
  {
    icon: <Network size={18} />,
    label: "2. Livepeer",
    title: "Generate through remote capability",
    body: "The app calls Livepeer remotely. No Livepeer capability, renderer, or model runs inside this demo container."
  },
  {
    icon: <ShieldCheck size={18} />,
    label: "3. Judge",
    title: "Judge the artifact blind",
    body: "The judge sees only the artifact and target criteria—not prompts, DKG memory, prior runs, or orchestration context."
  },
  {
    icon: <Database size={18} />,
    label: "4. DKG",
    title: "Persist reusable memory",
    body: "The DKG edge node stores a run ledger and improvement memory so the next attempt can improve."
  }
];

export function App() {
  const [state, setState] = useState<DemoState | null>(null);
  const [config, setConfig] = useState<ConfigStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [memoryUsed, setMemoryUsed] = useState<string[]>([]);
  const [selectedIteration, setSelectedIteration] = useState<number | "current">("current");

  useEffect(() => {
    void loadInitialState();
  }, []);

  async function loadInitialState() {
    setError(null);
    const [stateResponse, configResponse] = await Promise.all([fetch("/api/state"), fetch("/api/config")]);
    const loadedState = (await stateResponse.json()) as DemoState;
    setState(loadedState);
    setConfig(await configResponse.json());
    setSelectedIteration(loadedState.iterationSnapshots.at(-1)?.attemptNumber ?? "current");
  }

  async function runAttempt(useDkgMemory: boolean) {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/attempts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ useDkgMemory })
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Attempt failed.");
      }
      const payload = (await response.json()) as RunAttemptResponse;
      setState(payload.state);
      setMemoryUsed(payload.memoryUsed);
      setSelectedIteration(payload.attempt.attemptNumber);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Attempt failed.");
      try {
        const stateResponse = await fetch("/api/state");
        if (stateResponse.ok) {
          const recoveredState = (await stateResponse.json()) as DemoState;
          setState(recoveredState);
          setSelectedIteration(recoveredState.iterationSnapshots.at(-1)?.attemptNumber ?? "current");
        }
      } catch {
        // Keep the last rendered state if the recovery read also fails.
      }
    } finally {
      setLoading(false);
    }
  }

  async function reset() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/reset", { method: "POST" });
      setState(await response.json());
      setMemoryUsed([]);
      setSelectedIteration("current");
    } finally {
      setLoading(false);
    }
  }
  const iterationView = useMemo(() => {
    if (!state || selectedIteration === "current") {
      return state
        ? {
            label: "Before first run",
            attempt: state.attempts.at(-1) ?? null,
            runLedger: state.runLedger,
            improvementMemory: state.improvementMemory
          }
        : null;
    }

    const snapshot = state.iterationSnapshots.find((item) => item.attemptNumber === selectedIteration);
    return snapshot
      ? {
          label: `After Try ${snapshot.attemptNumber}`,
          attempt: state.attempts.find((item) => item.id === snapshot.attemptId) ?? null,
          runLedger: snapshot.runLedger,
          improvementMemory: snapshot.improvementMemory
        }
      : null;
  }, [selectedIteration, state]);

  const orchestratorMemory = useMemo(() => {
    if (memoryUsed.length) {
      return memoryUsed;
    }
    const attempt = iterationView?.attempt;
    if (!state || !attempt?.usedDkgMemory) {
      return [];
    }
    const previousMemory = state.iterationSnapshots.find(
      (snapshot) => snapshot.attemptNumber === attempt.attemptNumber - 1
    )?.improvementMemory;
    return previousMemory
      ? [
          ...previousMemory["demo:knownFailure"],
          ...previousMemory["demo:successfulPattern"],
          previousMemory["demo:nextPromptStrategy"]
        ].filter(Boolean)
      : [];
  }, [iterationView, memoryUsed, state]);

  if (!state) {
    return (
      <main className="loading-shell">
        <Loader2 className="spin" size={24} />
      </main>
    );
  }

  const bestScore = state.attempts.reduce((best, attempt) => Math.max(best, attempt.score), 0);

  return (
    <main className="app-shell">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Livepeer + OriginTrail workshop app</p>
          <h1>Agentic media iteration with DKG memory</h1>
          <p className="hero-subtitle">
            A Director orchestrates remote Livepeer generation, remote LLM judging, and DKG-backed memory so each
            attempt leaves useful evidence for the next one.
          </p>
        </div>
        <div className="hero-aside">
          <div className="hero-metric">
            <span>Best result</span>
            <strong>{bestScore}<small>/10</small></strong>
            <b>{state.attempts.length} completed {state.attempts.length === 1 ? "run" : "runs"}</b>
          </div>
          <div className="status-row" aria-label="Integration status">
            <StatusPill label="Livepeer" value={config?.livepeerMode ?? "mock"} active={config?.livepeerConfigured} />
            <StatusPill label="DKG edge" value={config?.dkgMode ?? "file"} active={config?.dkgConfigured} />
            <StatusPill label="Judge" value={config?.judgeMode ?? "mock"} active={config?.judgeConfigured} />
          </div>
        </div>
      </section>

      {error ? (
        <div className="error-banner" role="alert">
          <ShieldCheck size={19} />
          <div><strong>Memory sync needs another pass</strong><span>{error}</span></div>
          <button className="notice-close" onClick={() => setError(null)} aria-label="Dismiss message">Close</button>
        </div>
      ) : null}
      {loading ? (
        <div className="run-banner">
          <Loader2 className="spin" size={16} />
          Generating the artifact, running an isolated evaluation, and writing the DKG memory assets.
        </div>
      ) : null}

      <section className="command-deck">
        <div className="command-copy">
          <p className="history-kicker">Director controls</p>
          <h2>Run the next iteration</h2>
          <p>Generate a baseline from the brief, then let the Director retrieve the latest DKG memory for the next try.</p>
        </div>
        <div className="command-actions">
          <div className="button-row">
            <button onClick={() => runAttempt(false)} disabled={loading} title="Generate from the target brief only">
              {loading ? <Loader2 className="spin" size={16} /> : <Play size={16} />}
              Generate baseline
            </button>
            <button
              className="secondary"
              onClick={() => runAttempt(true)}
              disabled={loading || state.attempts.length === 0}
              title="Use the latest Improvement Memory Knowledge Asset"
            >
              <Brain size={16} />
              Improve with DKG
            </button>
            <button className="ghost" onClick={reset} disabled={loading} title="Start a fresh demo session">
              <RefreshCcw size={16} />
              New session
            </button>
          </div>
          <ScoreStrip attempts={state.attempts} targetScore={state.target.targetScore} />
        </div>
      </section>

      <Panel className="history-panel" icon={<History size={18} />} title="Iteration gallery">
        <div className="history-heading">
          <div>
            <p className="history-kicker">Compare every completed run</p>
            <h2>Artifact and knowledge state, side by side</h2>
            <p>
              Pick Try 1, Try 2, or any later run. The artifact and both knowledge-asset snapshots change together.
            </p>
          </div>
          <div className="isolation-note">
            <ShieldCheck size={18} />
            <span>
              <strong>Blind judge</strong>
              Artifact + target criteria only
            </span>
          </div>
        </div>

        <div className="iteration-tabs" role="tablist" aria-label="Choose an iteration">
          {state.iterationSnapshots.length ? (
            state.iterationSnapshots.map((snapshot) => {
              const attempt = state.attempts.find((item) => item.id === snapshot.attemptId);
              return (
                <button
                  className={selectedIteration === snapshot.attemptNumber ? "iteration-tab active" : "iteration-tab"}
                  key={snapshot.attemptNumber}
                  onClick={() => setSelectedIteration(snapshot.attemptNumber)}
                  role="tab"
                  aria-selected={selectedIteration === snapshot.attemptNumber}
                >
                  <img src={snapshot.artifactReference} alt="" />
                  <span>
                    <strong>Try {snapshot.attemptNumber}</strong>
                    <small>
                      {snapshot.improvementMemory["demo:latestScore"]}/10 · {attempt?.usedDkgMemory ? "DKG memory" : "Target only"}
                    </small>
                  </span>
                </button>
              );
            })
          ) : (
            <span className="no-iterations">Run the first attempt to start the gallery.</span>
          )}
        </div>

        {iterationView ? (
          <IterationInspector
            label={iterationView.label}
            attempt={iterationView.attempt}
            runLedger={iterationView.runLedger}
            improvementMemory={iterationView.improvementMemory}
          />
        ) : null}
      </Panel>

      <section className="stage-strip" aria-label="Demo flow">
        {stageCards.map((stage) => (
          <article className="stage-card" key={stage.label}>
            <div className="stage-label">
              {stage.icon}
              <span>{stage.label}</span>
            </div>
            <strong>{stage.title}</strong>
            <p>{stage.body}</p>
          </article>
        ))}
      </section>

      <section className="showcase-grid">
        <Panel className="target-panel" icon={<Target size={18} />} title="Target brief">
          <h2>{state.target.title}</h2>
          <p>{state.target.brief}</p>
          <div className="criteria-list">
            {state.target.successCriteria.map((criterion) => (
              <span key={criterion}>{criterion}</span>
            ))}
          </div>
          <div className="avoid-list">
            <strong>Avoid</strong>
            <span>{state.target.avoid.join(" · ")}</span>
          </div>
        </Panel>

        <Panel className="control-panel" icon={<Sparkles size={18} />} title="Run the loop">
          <div className="button-row">
            <button onClick={() => runAttempt(false)} disabled={loading} title="Run the first attempt without DKG memory">
              {loading ? <Loader2 className="spin" size={16} /> : <Play size={16} />}
              Run attempt
            </button>
            <button
              className="secondary"
              onClick={() => runAttempt(true)}
              disabled={loading || state.attempts.length === 0}
              title="Use the Improvement Memory Knowledge Asset for the next attempt"
            >
              <Brain size={16} />
              Try with DKG memory
            </button>
            <button className="ghost" onClick={reset} disabled={loading} title="Reset the demo state">
              <RefreshCcw size={16} />
              New demo session
            </button>
          </div>
          <ScoreStrip attempts={state.attempts} targetScore={state.target.targetScore} />
        </Panel>

        <Panel className="ledger-panel" icon={<Archive size={18} />} title="Run ledger">
          <div className="attempt-list">
            {state.attempts.length === 0 ? (
              <EmptyAttempt />
            ) : (
              state.attempts.map((attempt) => <AttemptRow key={attempt.id} attempt={attempt} />)
            )}
          </div>
        </Panel>

        <Panel className="memory-panel" icon={<GitBranch size={18} />} title="Orchestrator memory readback">
          <div className="memory-boundary"><ShieldCheck size={16} /> Used by the Director only; never sent to the judge.</div>
          {orchestratorMemory.length ? (
            <ul className="memory-used">
              {orchestratorMemory.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : (
            <p className="muted">After attempt 1, run “Try with DKG memory” to show the DKG readback changing the next prompt.</p>
          )}
        </Panel>
      </section>

      <section className="receipt-bar">
        <div>
          <strong>Submission receipt</strong>
          <span>
            {state.receipt.attemptCount} attempts, best score {state.receipt.bestScore}/10
          </span>
        </div>
        <a href="/api/receipt" target="_blank" rel="noreferrer">
          <Download size={16} />
          Export JSON
        </a>
      </section>
    </main>
  );
}

function Panel({ icon, title, children, className = "" }: { icon: ReactNode; title: string; children: ReactNode; className?: string }) {
  return (
    <section className={`panel ${className}`}>
      <header>
        <div className="panel-title">
          {icon}
          <span>{title}</span>
        </div>
      </header>
      {children}
    </section>
  );
}

function StatusPill({ label, value, active }: { label: string; value: string; active?: boolean }) {
  return (
    <div className={active ? "status-pill active" : "status-pill"}>
      <span>{label}</span>
      <strong>{value}</strong>
      {active ? <CheckCircle2 size={14} /> : null}
    </div>
  );
}

function ScoreStrip({ attempts, targetScore }: { attempts: AttemptRecord[]; targetScore: number }) {
  const slots = Array.from({ length: Math.max(3, attempts.length) }, (_, index) => index + 1);
  return (
    <div className="score-strip" aria-label="Attempt scores">
      {slots.map((slot) => {
        const attempt = attempts.find((item) => item.attemptNumber === slot);
        return (
          <div key={slot} className={attempt ? "score-slot filled" : "score-slot"}>
            <span>Try {slot}</span>
            <strong>{attempt ? `${attempt.score}/10` : "-"}</strong>
            {attempt?.score && attempt.score >= targetScore ? <small>pass</small> : null}
          </div>
        );
      })}
    </div>
  );
}

function IterationInspector({
  label,
  attempt,
  runLedger,
  improvementMemory
}: {
  label: string;
  attempt: AttemptRecord | null;
  runLedger: RunLedgerKa;
  improvementMemory: ImprovementMemoryKa;
}) {
  return (
    <div className="iteration-inspector">
      <section className="artifact-card">
        <div className="snapshot-title">
          <span>Produced artifact</span>
          <b>{label}</b>
        </div>
        {attempt ? <OutputPreview attempt={attempt} /> : <EmptyPreview />}
        {attempt ? (
          <div className="judge-result">
            <div className="judge-result-heading">
              <span><ShieldCheck size={16} /> {attempt.judgeScope === "blind-artifact" ? "Blind judge result" : "Previous judge result"}</span>
              <strong>{attempt.score}/10</strong>
            </div>
            <p>{attempt.judgeOutputSummary}</p>
            <small>
              {attempt.judgeScope === "blind-artifact"
                ? "Evaluation input: artifact + target criteria only."
                : "Recorded before blind-judge isolation; preserved as historical evidence."}
            </small>
          </div>
        ) : null}
      </section>
      <KnowledgeAssetSnapshot icon={<Archive size={17} />} title="Run Ledger KA" label={label} asset={runLedger}>
        <p className="asset-stat">{runLedger["demo:hasAttempt"].length} recorded attempts</p>
        <ol className="snapshot-attempts">
          {runLedger["demo:hasAttempt"].map((item, index) => (
            <li key={String(item["@id"] ?? index)}>
              <span>Try {String(item["demo:attemptNumber"] ?? index + 1)}</span>
              <strong>{String(item["demo:score"] ?? 0)}/10</strong>
            </li>
          ))}
        </ol>
      </KnowledgeAssetSnapshot>
      <KnowledgeAssetSnapshot
        icon={<Brain size={17} />}
        title="Improvement Memory KA"
        label={label}
        asset={improvementMemory}
      >
        <p className="asset-stat">Latest score {improvementMemory["demo:latestScore"]}/10</p>
        <AssetSection title="Known failures" lines={improvementMemory["demo:knownFailure"]} />
        <AssetSection title="Successful patterns" lines={improvementMemory["demo:successfulPattern"]} />
        <AssetSection title="Next prompt strategy" lines={[improvementMemory["demo:nextPromptStrategy"]]} />
      </KnowledgeAssetSnapshot>
    </div>
  );
}

function KnowledgeAssetSnapshot({
  icon,
  title,
  label,
  asset,
  children
}: {
  icon: ReactNode;
  title: string;
  label: string;
  asset: RunLedgerKa | ImprovementMemoryKa;
  children: ReactNode;
}) {
  return (
    <section className="snapshot-card">
      <div className="snapshot-title">
        <span>{icon}{title}</span>
        <b>{label}</b>
      </div>
      <code>{shortReference(asset["@id"])}</code>
      <div className="snapshot-content">{children}</div>
      <details className="json-details">
        <summary><Layers3 size={15} /> View JSON-LD snapshot</summary>
        <pre>{JSON.stringify(asset, null, 2)}</pre>
      </details>
    </section>
  );
}

function OutputPreview({ attempt }: { attempt: AttemptRecord }) {
  const previewable = attempt.outputReference.startsWith("http");
  return (
    <div className="output-preview">
      {previewable ? (
        <img src={attempt.outputReference} alt={`Livepeer output for attempt ${attempt.attemptNumber}`} />
      ) : (
        <div className="preview-placeholder">Livepeer output reference created</div>
      )}
      <div className="output-meta">
        <span>{attempt.usedDkgMemory ? "Generated with DKG memory" : "Generated from target only"}</span>
        <a href={attempt.outputReference} target="_blank" rel="noreferrer">
          Open output <ExternalLink size={14} />
        </a>
        {attempt.outputHash ? <code>{attempt.outputHash.slice(0, 16)}</code> : null}
      </div>
    </div>
  );
}

function EmptyPreview() {
  return (
    <div className="preview-placeholder tall">
      <Workflow size={22} />
      <span>Run an attempt to create the first Livepeer output.</span>
    </div>
  );
}

function EmptyAttempt() {
  return (
    <div className="empty-attempt">
      <Sparkles size={18} />
      <span>No attempts yet.</span>
    </div>
  );
}

function AttemptRow({ attempt }: { attempt: AttemptRecord }) {
  return (
    <article className="attempt-row">
      <div>
        <strong>Try {attempt.attemptNumber}</strong>
        <span>{attempt.usedDkgMemory ? "Used DKG memory" : "Target only"}</span>
      </div>
      <p>{attempt.judgeOutputSummary}</p>
      <a href={attempt.outputReference} target="_blank" rel="noreferrer">
        Output <ExternalLink size={13} />
      </a>
      <b>{attempt.score}/10</b>
    </article>
  );
}

function AssetSection({ title, lines }: { title: string; lines: string[] }) {
  const visibleLines = lines.filter(Boolean);
  return (
    <div className="asset-section">
      <strong>{title}</strong>
      {visibleLines.length ? (
        <ul>
          {visibleLines.map((line) => <li key={line}>{line}</li>)}
        </ul>
      ) : (
        <span>None yet</span>
      )}
    </div>
  );
}

function shortReference(value: string): string {
  const concise = value.split("/").filter(Boolean).slice(-3).join(" / ") || value;
  return concise.length > 68 ? `${concise.slice(0, 65)}...` : concise;
}
