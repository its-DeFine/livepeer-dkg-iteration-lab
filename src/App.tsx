import {
  Archive,
  Brain,
  CheckCircle2,
  Database,
  Download,
  ExternalLink,
  GitBranch,
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
import type { AttemptRecord, ConfigStatus, DemoState, RunAttemptResponse } from "../shared/types";

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
    title: "Score the attempt",
    body: "A remote Livepeer-backed judge returns compact feedback and a score that can be stored as evidence."
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

  useEffect(() => {
    void loadInitialState();
  }, []);

  async function loadInitialState() {
    setError(null);
    const [stateResponse, configResponse] = await Promise.all([fetch("/api/state"), fetch("/api/config")]);
    setState(await stateResponse.json());
    setConfig(await configResponse.json());
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
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Attempt failed.");
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
    } finally {
      setLoading(false);
    }
  }

  const bestAttempt = useMemo(() => {
    if (!state?.attempts.length) {
      return null;
    }
    return state.attempts.reduce((best, attempt) => (attempt.score > best.score ? attempt : best), state.attempts[0]);
  }, [state]);

  const latestAttempt = state?.attempts.at(-1) ?? null;

  if (!state) {
    return (
      <main className="loading-shell">
        <Loader2 className="spin" size={24} />
      </main>
    );
  }

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
        <div className="status-row" aria-label="Integration status">
          <StatusPill label="Livepeer gen" value={config?.livepeerMode ?? "mock"} active={config?.livepeerConfigured} />
          <StatusPill label="DKG edge" value={config?.dkgMode ?? "file"} active={config?.dkgConfigured} />
          <StatusPill label="LLM judge" value={config?.judgeMode ?? "mock"} active={config?.judgeConfigured} />
        </div>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}
      {loading ? (
        <div className="run-banner">
          <Loader2 className="spin" size={16} />
          Calling remote Livepeer, evaluating the output, and writing the DKG memory assets.
        </div>
      ) : null}

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

        <Panel className="output-panel" icon={<Sparkles size={18} />} title="Latest Livepeer output">
          {latestAttempt ? <OutputPreview attempt={latestAttempt} /> : <EmptyPreview />}
        </Panel>

        <Panel icon={<Archive size={18} />} title="Run ledger">
          <div className="attempt-list">
            {state.attempts.length === 0 ? (
              <EmptyAttempt />
            ) : (
              state.attempts.map((attempt) => <AttemptRow key={attempt.id} attempt={attempt} />)
            )}
          </div>
        </Panel>

        <Panel icon={<Database size={18} />} title="DKG knowledge assets">
          <div className="asset-grid">
            <AssetCard
              title="Run Ledger KA"
              value={shortReference(state.receipt.runLedgerReference)}
              lines={[`${state.attempts.length} attempt records`, bestAttempt ? `Best score ${bestAttempt.score}/10` : "Waiting for first run"]}
            />
            <AssetCard
              title="Improvement Memory KA"
              value={shortReference(state.receipt.improvementMemoryReference)}
              lines={[
                ...state.improvementMemory["demo:knownFailure"],
                ...state.improvementMemory["demo:successfulPattern"],
                state.improvementMemory["demo:nextPromptStrategy"]
              ]}
            />
          </div>
        </Panel>

        <Panel icon={<Brain size={18} />} title="Remote judge">
          {bestAttempt ? (
            <div className="judge-box">
              <div className="score-lockup">
                <strong>{bestAttempt.score}/10</strong>
                <span className={bestAttempt.pass ? "pass" : "needs-work"}>
                  {bestAttempt.pass ? "Target reached" : "Keep iterating"}
                </span>
              </div>
              <p>{bestAttempt.judgeOutputSummary}</p>
              {bestAttempt.judgeReference ? <small>{bestAttempt.judgeReference}</small> : null}
            </div>
          ) : (
            <p className="muted">The judge scores each remote output against the brief and stores the result in DKG.</p>
          )}
        </Panel>

        <Panel icon={<GitBranch size={18} />} title="Memory used in the next prompt">
          {memoryUsed.length ? (
            <ul className="memory-used">
              {memoryUsed.map((line) => (
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
  const slots = [1, 2, 3];
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

function AssetCard({ title, value, lines }: { title: string; value: string; lines: string[] }) {
  return (
    <div className="asset-card">
      <strong>{title}</strong>
      <code>{value}</code>
      <ul>
        {lines.filter(Boolean).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

function shortReference(value: string): string {
  const last = value.split("/").filter(Boolean).at(-1) ?? value;
  return last.length > 48 ? `${last.slice(0, 45)}...` : last;
}
