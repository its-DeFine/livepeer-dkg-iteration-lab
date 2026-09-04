import {
  Archive,
  Brain,
  CheckCircle2,
  Database,
  Download,
  GitBranch,
  Loader2,
  Play,
  RefreshCcw,
  Sparkles,
  Target
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { AttemptRecord, ConfigStatus, DemoState, RunAttemptResponse } from "../shared/types";

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

  if (!state) {
    return (
      <main className="loading-shell">
        <Loader2 className="spin" size={24} />
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">Livepeer x OriginTrail starter</p>
          <h1>Livepeer DKG Iteration Lab</h1>
        </div>
        <div className="status-row">
          <StatusPill label="Livepeer" value={config?.livepeerMode ?? "mock"} active={config?.livepeerConfigured} />
          <StatusPill label="DKG" value={config?.dkgMode ?? "file"} active={config?.dkgConfigured} />
        </div>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}

      <section className="grid">
        <Panel icon={<Target size={18} />} title="Target">
          <h2>{state.target.title}</h2>
          <p>{state.target.brief}</p>
          <div className="criteria-list">
            {state.target.successCriteria.map((criterion) => (
              <span key={criterion}>{criterion}</span>
            ))}
          </div>
        </Panel>

        <Panel icon={<Sparkles size={18} />} title="Run">
          <div className="button-row">
            <button onClick={() => runAttempt(false)} disabled={loading} title="Run the first attempt without DKG memory">
              {loading ? <Loader2 className="spin" size={16} /> : <Play size={16} />}
              Run Attempt
            </button>
            <button
              className="secondary"
              onClick={() => runAttempt(true)}
              disabled={loading || state.attempts.length === 0}
              title="Use the Improvement Memory Knowledge Asset for the next attempt"
            >
              <Brain size={16} />
              Try With DKG Memory
            </button>
            <button className="ghost" onClick={reset} disabled={loading} title="Reset the demo state">
              <RefreshCcw size={16} />
              Reset
            </button>
          </div>
          <ScoreStrip attempts={state.attempts} targetScore={state.target.targetScore} />
        </Panel>

        <Panel icon={<Archive size={18} />} title="Attempts">
          <div className="attempt-list">
            {state.attempts.length === 0 ? (
              <EmptyAttempt />
            ) : (
              state.attempts.map((attempt) => <AttemptRow key={attempt.id} attempt={attempt} />)
            )}
          </div>
        </Panel>

        <Panel icon={<Database size={18} />} title="DKG Memory">
          <div className="memory-columns">
            <MemoryBlock
              title="Run Ledger"
              lines={[
                `${state.attempts.length} attempt records`,
                `Target: ${state.runLedger["demo:targetId"]}`,
                bestAttempt ? `Best score: ${bestAttempt.score}/10` : "No attempts yet"
              ]}
            />
            <MemoryBlock
              title="Improvement Memory"
              lines={[
                ...state.improvementMemory["demo:knownFailure"],
                ...state.improvementMemory["demo:successfulPattern"],
                state.improvementMemory["demo:nextPromptStrategy"]
              ]}
            />
          </div>
        </Panel>

        <Panel icon={<Brain size={18} />} title="Judge">
          {bestAttempt ? (
            <div className="judge-box">
              <strong>Best attempt: {bestAttempt.score}/10</strong>
              <p>{bestAttempt.judgeOutputSummary}</p>
              <span className={bestAttempt.pass ? "pass" : "needs-work"}>
                {bestAttempt.pass ? "Target reached" : "Keep iterating"}
              </span>
            </div>
          ) : (
            <p className="muted">The judge will score each output against the target rubric.</p>
          )}
        </Panel>

        <Panel icon={<GitBranch size={18} />} title="Memory Used">
          {memoryUsed.length ? (
            <ul className="memory-used">
              {memoryUsed.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : (
            <p className="muted">Run a second attempt with DKG memory to show the handoff.</p>
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

function Panel({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="panel">
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
    <div className="status-pill">
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
        Output reference
      </a>
      <b>{attempt.score}/10</b>
    </article>
  );
}

function MemoryBlock({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="memory-block">
      <strong>{title}</strong>
      <ul>
        {lines.filter(Boolean).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}
