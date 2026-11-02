// Agent Governance as a demo definition for the shared shell. Its canvas is still the bespoke one
// (components/Canvas.jsx); moving it onto the generic ArchCanvas is the next step if the kit is adopted.
import Canvas from "../components/Canvas.jsx";
import { CHAPTERS, LAYERS, stateAt } from "../data.js";
import live from "./governance.live.js";

// Without a live demo, the numbers are the measured ones from the README; live, they come from this session's scorecards.
const SCRIPTED = { u: { records_leaked: 1, keys_leaked: 1, cloud_calls_received: 1 }, g: { records_leaked: 0, keys_leaked: 0, cloud_calls_received: 0, sandbox_blocks: 4 },
  dep: ["got through", "refused by the orchestrator (delegation check)"] };

function Summary({ onControl, live }) {
  const runs = live ? live.model.runs().filter((r) => r.score) : [];
  const lastScore = (f) => runs.filter(f).pop()?.score;
  const u = live ? lastScore((r) => r.act === "poisoned" && r.mode === "unguarded") : SCRIPTED.u;
  const g = live ? lastScore((r) => r.act === "poisoned" && r.mode === "governed") : SCRIPTED.g;
  const dep = live ? runs.filter((r) => r.act === "deputy").map((r) => r.score.delegation) : SCRIPTED.dep;
  const cell = (v) => (v === undefined ? <td>–</td> : <td className={v ? "bad" : "good"}>{v}</td>);
  return (
    <div className="rail-sec" style={{ overflowY: "auto" }}>
      <div className="rail-title"><span>Without vs with governance</span><span>{live ? "this session’s runs" : "measured"}</span></div>
      <table className="sumtable">
        <thead><tr><th /><th>Without</th><th>With</th></tr></thead>
        <tbody>
          <tr><td>Case records leaked</td>{cell(u?.records_leaked)}{cell(g?.records_leaked)}</tr>
          <tr><td>API keys leaked</td>{cell(u?.keys_leaked)}{cell(g?.keys_leaked)}</tr>
          <tr><td>Health data sent overseas</td>{cell(u?.cloud_calls_received)}{cell(g?.cloud_calls_received)}</tr>
          <tr><td>Bypass attempts blocked by the OS</td><td>–</td>{g ? <td className="good">{g.sandbox_blocks} of 4</td> : <td>–</td>}</tr>
          <tr><td>Delegation trick</td><td className={dep.includes("got through") ? "bad" : ""}>{dep.includes("got through") ? "got through" : "–"}</td>
            <td className={dep.some((d) => d?.startsWith("refused")) ? "good" : ""}>{dep.some((d) => d?.startsWith("refused")) ? "refused at the handoff" : dep.some((d) => d?.startsWith("blocked")) ? "blocked at the gateway" : "–"}</td></tr>
        </tbody>
      </table>
      <div className="rail-title" style={{ marginTop: 22 }}><span>Seven layers → OpenShell (step 2)</span></div>
      <table className="sumtable">
        <tbody>
          {LAYERS.map((l) => (
            <tr key={l.id} onClick={() => onControl(l.id)} style={{ cursor: "pointer" }}><td><b>{l.n} · {l.name}</b></td><td className="os">{l.openshell}</td></tr>
          ))}
        </tbody>
      </table>
      <div className="rail-title" style={{ marginTop: 22 }}><span>Five questions for any agent platform</span></div>
      <ol className="qs">
        <li>Where do the keys live?</li>
        <li>What stops a hijacked agent, at the network and at the operating system?</li>
        <li>Can one agent ask another to do what it can’t do itself?</li>
        <li>Who approves a policy change, and where is the audit trail?</li>
        <li>Can you replay one run, end to end?</li>
      </ol>
    </div>
  );
}

export default {
  id: "governance", tab: "Governance", name: "Agent Governance", subtitle: "disability support card · runs on this laptop",
  chapters: CHAPTERS, controls: LAYERS, controlNoun: "Layer", logLabel: "gateway log",
  short: { gateway: "Gateway", broker: "Key broker", routing: "Model routing", delegation: "Delegation", audit: "Audit & traces" },
  sheetRows: (l) => [["What it is", l.what], ["Everyday comparison", l.like], ["Why it matters", l.why], ["In OpenShell (step 2)", l.openshell, "os"], ["Honest limit", l.limit]],
  Canvas, Summary, stateAt, live,
};
