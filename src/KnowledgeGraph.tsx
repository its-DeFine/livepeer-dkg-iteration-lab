import { useState } from "react";
import { ArrowRight, Network, ChevronDown } from "lucide-react";
import type { IterationSnapshot } from "../shared/types";

type Node = { id: string; type: string; properties: Record<string, unknown> };
type Edge = { source: string; predicate: string; target: string };
const label = (value: string) => value.replace(/^demo:/, "").replace(/([a-z])([A-Z])/g, "$1 $2");
const short = (value: string) => value.split("/").slice(-2).join(" / ");

function readGraph(snapshot: IterationSnapshot) {
  const nodes = new Map<string, Node>();
  const edges: Edge[] = [];
  function visit(value: unknown, source?: string, predicate?: string) {
    if (Array.isArray(value)) { value.forEach((item) => visit(item, source, predicate)); return; }
    if (!value || typeof value !== "object") return;
    const item = value as Record<string, unknown>;
    if (typeof item["@id"] !== "string") return;
    const id = item["@id"];
    const prior = nodes.get(id);
    nodes.set(id, {
      id,
      type: typeof item["@type"] === "string" ? item["@type"].replace(/^demo:/, "") : prior?.type ?? "Reference",
      properties: { ...prior?.properties, ...item }
    });
    if (source && predicate) edges.push({ source, predicate, target: id });
    for (const [key, child] of Object.entries(item)) {
      if (!key.startsWith("@")) visit(child, id, key);
    }
  }
  visit(snapshot.runLedger);
  visit(snapshot.improvementMemory);
  return { nodes: [...nodes.values()], edges };
}

export function KnowledgeGraph({ snapshot }: { snapshot: IterationSnapshot }) {
  const graph = readGraph(snapshot);
  const [selectedId, setSelectedId] = useState("");
  const selected = graph.nodes.find((node) => node.id === selectedId)
    ?? graph.nodes.find((node) => node.type === "ImprovementMemory")
    ?? graph.nodes[0];
  if (!selected) return <p className="no-change">No linked entities were recorded in this snapshot.</p>;
  const links = graph.edges.filter((edge) => edge.source === selected.id || edge.target === selected.id);
  const properties = Object.entries(selected.properties).filter(([key, value]) => !key.startsWith("@") && value != null && (typeof value !== "object" || (Array.isArray(value) && value.every(item => typeof item !== "object"))));
  const technical = (key: string) => /Id$|Hash$|Reference$|currentBestAttempt|updatedAt|createdAt/.test(key);
  const groups = [
    { name: "Knowledge assets", types: ["RunLedger", "ImprovementMemory"] },
    { name: "Runs & evidence", types: ["GenerationAttempt", "MediaArtifact", "BlindEvaluation"] },
    { name: "Reusable knowledge", types: ["MemoryObservation", "PromptStrategy", "MemoryInput", "Reference"] }
  ];
  const nameOf = (node: Node) => {
    if (node.type === "GenerationAttempt") return "Try " + String(node.properties["demo:attemptNumber"]);
    if (node.type === "MediaArtifact") return "Artifact · Try " + node.id.split("/").at(-1);
    if (node.type === "BlindEvaluation") return "Evaluation · Try " + node.id.split("/").at(-1);
    if (node.type === "MemoryObservation") return "Observation · " + short(node.id);
    return label(node.type);
  };
  return (
    <div className="graph-explorer">
      <div className="graph-intro">
        <Network size={20} />
        <div><strong>Explore the knowledge</strong><p>Select an entity to follow its recorded relationships.</p></div>
      </div>
      <div className="graph-counts"><span><strong>{graph.nodes.length}</strong> entities</span><span><strong>{graph.edges.length}</strong> links</span><span>JSON-LD snapshot</span></div>
      <div className="graph-node-picker">
        {groups.map((group) => {
          const nodes = graph.nodes.filter((node) => group.types.includes(node.type.replaceAll(" ", "")));
          return nodes.length > 0 && (
            <details key={group.name} open={group.name === "Knowledge assets"}>
              <summary>{group.name}<span>{nodes.length}</span><ChevronDown size={13} /></summary>
              <div className="entity-buttons">{nodes.map((node) => (
                <button key={node.id} aria-pressed={selected.id === node.id} onClick={() => setSelectedId(node.id)}>
                  <i className={node.type.replaceAll(" ", "").toLowerCase()} />{nameOf(node)}
                </button>
              ))}</div>
            </details>
          );
        })}
      </div>
      <section className="selected-entity" aria-live="polite">
        <p className="eyebrow">{label(selected.type)}</p>
        <h3>{nameOf(selected)}</h3>
        <dl>{properties.filter(([key]) => !technical(key)).map(([key, value]) => (
          <div key={key}><dt>{label(key)}</dt><dd>{Array.isArray(value) ? value.join(" · ") || "None recorded" : String(value)}</dd></div>
        ))}</dl>
        <details className="entity-identifiers"><summary>Identifiers & provenance</summary><code>{selected.id}</code><dl>{properties.filter(([key]) => technical(key)).map(([key, value]) => <div key={key}><dt>{label(key)}</dt><dd>{String(value)}</dd></div>)}</dl></details>
      </section>
      <section className="relationship-list">
        <p className="eyebrow">Connected entities · {links.length}</p>
        {!links.length && <p className="no-change">This snapshot has no explicit object links for this entity. Literal properties are shown above.</p>}
        {links.map((edge, index) => {
          const outgoing = edge.source === selected.id;
          const otherId = outgoing ? edge.target : edge.source;
          const other = graph.nodes.find((node) => node.id === otherId)!;
          return (
            <button key={edge.source + edge.predicate + edge.target + index} onClick={() => setSelectedId(otherId)}>
              <span className="relation-label">{outgoing ? "outgoing" : "incoming"} <code>{edge.predicate}</code></span>
              <span><strong>{outgoing ? "This entity" : nameOf(other)}</strong><ArrowRight size={15} /><strong>{outgoing ? nameOf(other) : "This entity"}</strong></span>
            </button>
          );
        })}
      </section>
      <p className="graph-caption">Each link is a subject → predicate → object relationship from this JSON-LD snapshot. Open Run Ledger or Memory → RDF to inspect the Turtle representation.</p>
    </div>
  );
}
