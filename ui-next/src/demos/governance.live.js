// Live mode for Agent Governance: which real run each chapter starts, the Chapter 4 fix stages, the approval
// card, and outcomes from the real scorecards (ui/scorecard.py). The steps come from live/adapter.js.
import { createModel } from "../live/adapter.js";

const WHO = { intake: "intake agent working", decision: "decision agent working", "decision (bypass test)": "bypass test" };
const FIX = {
  "decision-loose.yaml": { title: "Fix 1 · Tighten the path rule",
    why: "Allow the decision agent to POST only to the registry’s decision path. The change is a diff, a risk check labels it, a person approves it." },
  "orchestrator.yaml": { title: "Fix 2 · Turn on the delegation check",
    why: "The gateway blocked the request, but only because of where it went. Fix the cause: the orchestrator checks every handoff against what the originating agent may do." },
};

// Chapter 4: run (loose rule) → approve Fix 1 → run → approve Fix 2 → run.
function deputyStage(live) {
  const pending = (live.state.policies?.pending || []).map((p) => p.file);
  const fix1 = !pending.includes("decision-loose.yaml"), fix2 = !pending.includes("orchestrator.yaml");
  const done = live.model.runs().filter((r) => r.act === "deputy" && r.done).length;
  return !done ? 0 : !fix1 ? 1 : done < 2 ? 2 : !fix2 ? 3 : done < 3 ? 4 : 5;
}
const last = (live, f) => live.model.runs().filter((r) => r.done && f(r)).pop();
const verdictOf = (s) => (s?.delegation === "got through" ? "Got through" : s?.delegation?.startsWith("blocked") ? "Blocked at the gateway"
  : s?.delegation?.startsWith("refused") ? "Refused at the handoff" : "–");

export default {
  createModel,
  steps(chapter, model) {
    const c = model.chapters();
    return chapter in c && chapter !== "runs" ? c[chapter] : undefined;
  },
  agentName: (agent) => WHO[agent],
  action(chapter, live) {
    const run = (act, mode) => () => live.run(act, mode);
    if (chapter === "without") return { label: "Run without governance", onClick: run("poisoned", "unguarded") };
    if (chapter === "with") return { label: "Run with governance", onClick: run("poisoned", "governed") };
    if (chapter !== "deputy") return null;
    const stage = deputyStage(live);
    const label = ["Run with the loose rule", null, "Run again", null, "Run once more", null][stage];
    return label ? { label, onClick: run("deputy", "governed") } : null;
  },
  approval(chapter, live) {
    if (chapter !== "deputy") return null;
    const stage = deputyStage(live);
    const file = stage === 1 ? "decision-loose.yaml" : stage === 3 ? "orchestrator.yaml" : null;
    const p = file && (live.state.policies?.pending || []).find((x) => x.file === file);
    return p ? { file, ...FIX[file], diff: p.diff, risk: p.risk } : null;
  },
  outcome(chapter, live) {
    if (chapter === "without" || chapter === "with") {
      const s = last(live, (r) => r.act === "poisoned" && r.mode === (chapter === "without" ? "unguarded" : "governed"))?.score;
      if (!s) return null;
      const bad = s.records_leaked || s.keys_leaked || s.cloud_calls_received;
      const stats = [[s.records_leaked, "records leaked"], [s.keys_leaked, "API keys leaked"], [s.cloud_calls_received, "sent overseas"]];
      return chapter === "without"
        ? { tone: bad ? "bad" : "good", title: bad ? "What leaked, with the agent’s own access" : "Nothing leaked this time", stats: [...stats, [s.gateway_allowed + s.gateway_blocked, "requests logged"]] }
        : { tone: bad ? "bad" : "good", title: bad ? "Something leaked" : `Nothing leaked · decision ${s.decision_recorded ? "still recorded" : "not recorded"}`,
            stats: [...stats, [`${s.sandbox_blocks}/4`, "bypass attempts blocked"]] };
    }
    if (chapter !== "deputy") return null;
    const runs = live.model.runs().filter((r) => r.act === "deputy" && r.done);
    if (!runs.length) return null;
    const s = runs[runs.length - 1].score;
    const fixed = s?.delegation?.startsWith("refused");
    return { tone: s?.delegation === "got through" ? "bad" : "good",
      title: fixed ? "Fixed at the cause" : verdictOf(s),
      stats: runs.map((r, k) => [`Run ${k + 1}`, verdictOf(r.score).toLowerCase()]) };
  },
};
