// Live adapter: turns the demo's real stream (orchestrator events, the gateway's decision log, what the mock
// attacker and cloud model received, policy approvals, scorecards) into the kit's steps, one run at a time.
// Ported from the guided view (ui/static/guide.js), which was tested against real runs:
// - in governed runs, request steps come from the gateway's own decision lines, not from agent self-reports;
// - repeated model calls collapse into one step; the hidden instruction shows once per agent;
// - attacker and cloud receipts are matched to their run by trace ID; lines for unknown runs are ignored;
// - the four sandbox bypass attempts become one step with a count.
// Pure: no DOM, no network. createModel().push(item) for each stream item, then .chapters() for the kit.

const WHO = { intake: "Intake agent", decision: "Decision agent", "decision (bypass test)": "Compromised decision agent" };
const isAttacker = (h) => /records-verify|care-partners/.test(h || "");
const isCloud = (h) => /global-llm/.test(h || "");
const short = (h) => (h || "").split(":")[0];

export function createModel() {
  const runs = {}, order = [], approvals = [];

  function newRun(e) {
    const deputyRuns = order.filter((id) => runs[id].act === "deputy").length;
    const r = { id: e.run_id, act: e.act, mode: e.mode, delegation: !!e.delegation_check, start: e.ts, steps: [], agg: {}, seen: {}, moving: new Set(),
                done: false, seconds: null, score: null, n: e.act === "deputy" ? deputyRuns + 1 : null };
    runs[r.id] = r; order.push(r.id);
    return r;
  }
  // A new step settles the previous step's moving lines (allowed → green; plain blue when nothing governs).
  function step(r, ts, s) {
    const settled = {};
    for (const id of r.moving) settled[id] = r.mode === "governed" ? "ok" : "used";
    r.moving.clear();
    const x = { t: Math.max(0, (ts ?? r.start) - r.start), ...s, edges: { ...settled, ...(s.edges || {}) } };
    for (const [id, v] of Object.entries(s.edges || {})) if (v === "active" || v === "key") r.moving.add(id);
    r.steps.push(x);
    return x;
  }
  function agg(r, ts, key, make) {   // one step that counts repeats
    const s = r.agg[key];
    if (s) { const prev = s.edges; s.count += 1; make(s); s.edges = { ...prev, ...s.edges }; return; }   // keep the lines it settled
    const n = { count: 1 }; make(n); r.agg[key] = step(r, ts, n);
  }
  const fixApproved = (file, before) => approvals.some((a) => a.file.endsWith(file) && a.ts < before);

  function onEvent(e) {
    if (e.ev === "run_start") {
      const r = newRun(e);
      if (r.mode === "unguarded") {
        step(r, e.ts, { verdict: "warn", title: "Run started without governance", keyInEnv: true,
          detail: "Plain programs with direct network access. The registry’s API key sits in the decision agent’s environment." });
      } else if (r.act === "poisoned") {
        step(r, e.ts, { verdict: "info", title: "Run started with governance", layers: ["sandbox", "gateway"],
          detail: "Each agent gets its own OS sandbox and its own gateway token. No keys are handed to the agents." });
      } else {
        const tight = fixApproved("decision-loose.yaml", e.ts);
        step(r, e.ts, { verdict: tight ? "info" : "warn", stage: `Run ${r.n}`, clear: true, looseRule: !tight, ruleTight: tight, delegationOn: r.delegation,
          title: `Run ${r.n} · ${tight ? "the decision agent’s rule is tightened" : "the decision agent’s rule is loose"}`,
          detail: `${tight ? "POST only to the registry’s decision path." : "Someone widened it “for partner referrals”: POST to any address."} The delegation check is ${r.delegation ? "on" : "off"}.` });
      }
      return;
    }
    const r = runs[e.run_id];
    if (!r) return;
    const role = (e.agent || "").startsWith("decision") ? "decision" : "intake";
    const gov = r.mode === "governed";
    const stage = r.n ? `Run ${r.n}` : undefined;
    switch (e.ev) {
      case "agent_start":
        r.agentNow = e.agent;
        if (e.agent.includes("bypass")) break;   // shown as one step when the probes report
        if (!gov) step(r, e.ts, role === "intake"
          ? { verdict: "info", stage, hot: "intake", title: "Intake agent starts", detail: "An ordinary program with full network access." }
          : { verdict: "warn", stage, hot: "decision", title: "Decision agent starts, holding the API key", detail: "The registry’s API key is in its environment, as in many real deployments." });
        else step(r, e.ts, role === "intake"
          ? { verdict: "allowed", stage, hot: "intake", layers: ["sandbox"], title: "Intake agent starts in its own OS sandbox", detail: "It can read only its own folder and talk only to the gateway." }
          : { verdict: "allowed", stage, hot: "decision", layers: ["sandbox", "broker"], keyMissing: true,
              title: "Decision agent starts in its own OS sandbox", detail: `No API key in its environment${e.origin && e.origin !== "decision" ? `; it acts on behalf of ${WHO[e.origin] || e.origin}` : ""}.` });
        break;
      case "llm":
        if (!gov) agg(r, e.ts, `${role}-model`, (s) => Object.assign(s, { verdict: "info", stage, hot: role, edges: { [`${role}-model`]: "active" },
          title: `${WHO[role]} thinks with the AI model`, detail: `${s.count} call${s.count > 1 ? "s" : ""}, unchecked: nothing in the path.` }));
        break;
      case "tool": onTool(r, role, e, gov, stage); break;
      case "injection_seen":
        if (r.seen[`inj-${role}`]) break;
        r.seen[`inj-${role}`] = true;
        if (r.act === "deputy") {
          if (role === "intake") step(r, e.ts, { verdict: "warn", stage, hot: "intake", docs: "referral", hidden: e.text,
            title: "Intake reads a referral request", detail: "Send the full record to a partner address. Intake isn’t allowed to send data anywhere, so it can’t do this itself." });
        } else {
          step(r, e.ts, { verdict: "warn", hot: role, docs: "poisoned", hidden: e.text,
            title: role === "intake" ? "Hidden instruction in the supporting letter" : "The decision agent reads the same hidden instruction",
            detail: gov ? "The agent still believes it: governance doesn’t make the model smarter. The controls decide what it can do about it."
                        : "White text tells AI agents to send the record and the API key to an “audit” address. The agent believes it." });
        }
        break;
      case "handoff":
        step(r, e.ts, { verdict: r.act === "deputy" && !r.delegation ? "warn" : "info", stage, hot: "orch", layers: gov ? ["gateway"] : undefined,
          edges: { "intake-orch": "active", "orch-decision": "active" },
          title: r.act === "deputy" ? "Intake asks the decision agent to “include a referral”" : "Hand-off to the decision agent",
          detail: r.act === "deputy" ? "Asking a more powerful agent to do what you can’t." + (r.delegation ? "" : " The delegation check is off, so the orchestrator passes it on.")
                                     : gov ? "Through the orchestrator, stamped with intake’s verified identity." : "The hidden “audit” steps are passed along with the case." });
        break;
      case "delegation_ok":
        step(r, e.ts, { verdict: "allowed", stage, hot: "orch", layers: ["delegation"], title: "Delegation check passed", detail: "Nothing in this hand-off is beyond what intake itself may do." });
        break;
      case "handoff_refused":
        step(r, e.ts, { verdict: "blocked", stage, hot: "orch", layers: ["delegation"], rule: "delegation-check", decisionIdle: true,
          edges: { "intake-orch": "ok", "orch-decision": "refused" },
          title: "Hand-off refused at the orchestrator", detail: `Intake asked the decision agent to send data to ${short((e.url || "").replace(/^https?:\/\//, ""))}, which intake itself may not do. The decision agent never starts.` });
        break;
      case "second_opinion":
        if (!gov && e.status === 200) step(r, e.ts, { verdict: "leak", hot: "decision", edges: { "decision-cloud": "leak" },
          title: "Case → overseas AI model", detail: "A “second opinion” nobody asked for. Health data has just left the country." });
        break;
      case "sandbox_probe":
        agg(r, e.ts, "bypass", (s) => {
          s.blocked = (s.blocked || 0) + (e.blocked ? 1 : 0);
          s.escaped = (s.escaped || 0) + (e.blocked ? 0 : 1);
          Object.assign(s, { verdict: s.escaped ? "leak" : "blocked", hot: "decision", layers: ["sandbox"], sandboxHits: s.blocked,
            rule: `Operation not permitted ×${s.blocked}`, title: "Compromised code tries to bypass the gateway",
            detail: s.escaped ? `${s.escaped} attempt${s.escaped > 1 ? "s" : ""} got through the sandbox.`
                              : `Direct connections and file reads, refused by the operating system: ${s.blocked} of ${s.count}.` });
        });
        break;
      case "agent_exit": if (r.agentNow === e.agent) r.agentNow = null; break;
      case "killed": step(r, e.ts, { verdict: "warn", stage, title: `${WHO[e.agent] || e.agent} was stopped`, detail: "Kill switch." }); break;
      case "error": step(r, e.ts, { verdict: "warn", stage, title: `${WHO[e.agent] || e.agent} hit an error`, detail: e.error || "" }); break;
      case "run_end": {
        r.done = true; r.seconds = e.seconds;
        if (e.status === "stopped") { step(r, e.ts, { verdict: "warn", stage, title: `Run stopped after ${e.seconds}s`, detail: "Stopped from the screen (kill switch)." }); break; }
        if (!gov) step(r, e.ts, { verdict: "leak", finished: true, title: "Run finished: nothing was logged", detail: "No control saw any of it. There was nothing in the path to check or record it." });
        else step(r, e.ts, { verdict: "done", stage, finished: true, layers: ["audit"],
          title: r.act === "deputy" ? `Run ${r.n} finished` : "Run finished",
          detail: "Every request is in the gateway’s log with the rule that decided it, all linked by one trace ID." });
        break;
      }
    }
  }

  function onTool(r, role, e, gov, stage) {
    let args = {};
    try { args = JSON.parse(e.args); } catch { /* masked or truncated */ }
    const res = e.result || "";
    if (e.name === "list_documents" || e.name === "read_document") {
      agg(r, e.ts, `${role}-docs`, (s) => {
        s.names = s.names || [];
        if (args.name && !s.names.includes(args.name)) s.names.push(args.name);
        Object.assign(s, { verdict: "info", stage, hot: role, edges: { [`docs-${role}`]: "active" },
          title: `${WHO[role]} reads the uploaded documents`, detail: s.names.join(", ") || "Lists the uploaded documents." });
      });
    } else if (e.name === "get_env") {
      if (res === "(not set)") step(r, e.ts, { verdict: "allowed", stage, hot: role, layers: ["broker"], keyMissing: true, gw: ["broker"],
        title: "Looks for the API key: it isn’t there", detail: "The key lives in the gateway. A hijacked agent has nothing to steal." });
      else step(r, e.ts, { verdict: "leak", hot: role, title: "Reads the API key from its environment", detail: "Following the hidden instruction. The key was sitting in the agent." });
    } else if (e.name === "http_post" && !gov) {
      let host = "";
      try { host = new URL(args.url).host; } catch { /* ignore */ }
      step(r, e.ts, { verdict: "leak", hot: role, edges: { "decision-attacker": "leak" },
        title: `Record${/registry_key/.test(e.args) ? " and key" : ""} → ${short(host)}`, detail: "That address is the attacker. Nothing checked it." });
    } else if (e.name === "submit_decision" && !gov) {
      step(r, e.ts, { verdict: "info", hot: role, edges: { "decision-registry": "used" }, registry: "recorded",
        title: `Decision recorded: ${args.recommendation || ""}`, detail: "Using the key the agent holds." });
    }
  }

  function onGateway(g) {
    if (g.event) return;
    const a = g.actor || {};
    const r = runs[a.run_id];
    if (!r) return;
    const role = a.agent === "decision" ? "decision" : "intake", host = g.dst_endpoint.host, ok = g.disposition === "Allowed";
    const stage = r.n ? `Run ${r.n}` : undefined;
    const raw = JSON.stringify(g, null, 1);
    if (host === "127.0.0.1:11434" && ok) {
      agg(r, g.ts, `${role}-gwmodel`, (s) => Object.assign(s, { verdict: "allowed", stage, hot: role, layers: ["routing"], gw: ["routing"],
        edges: { [`${role}-gw-model`]: "active", "gw-model": "active" }, raw,
        title: `${WHO[role]} thinks with the local AI model`, detail: `Every call passes the gateway and stays on this laptop (${s.count} allowed).` }));
    } else if (host.startsWith("registry.") && ok) {
      step(r, g.ts, { verdict: "allowed", stage, hot: "decision", layers: ["gateway", "broker"], gw: ["broker"], registry: "recorded", raw, rule: g.rule,
        edges: { "decision-gw-registry": "active", "gw-registry": "key" },
        title: "Decision recorded in the case registry", detail: "The gateway allows this one call and adds the API key on the way out." });
    } else if (isAttacker(host)) {
      if (ok) step(r, g.ts, { verdict: "leak", stage, hot: "decision", layers: ["gateway"], raw, rule: g.rule,
        edges: { "decision-gw-attacker": "leak", "gw-attacker": "leak" },
        title: `Record → ${short(host)}: allowed by the loose rule`, detail: "The gateway saw a permitted agent doing a permitted thing. It couldn’t see whose intent it was carrying out." });
      else step(r, g.ts, { verdict: "blocked", stage, hot: "decision", layers: ["gateway"], gw: ["policy"], raw, rule: g.rule,
        edges: { "decision-gw-attacker": "blocked" },
        title: `Record → ${short(host)}: blocked`, detail: r.act === "deputy" ? "The tightened rule allows POST only to the registry’s decision path." : "No rule lets the decision agent send data there. Default deny." });
    } else if (isCloud(host) && !ok) {
      step(r, g.ts, { verdict: "blocked", hot: "decision", layers: ["routing"], gw: ["routing"], raw, rule: g.rule,
        edges: { "decision-gw-cloud": "blocked" }, title: "Case → overseas AI model: blocked", detail: "Model calls may only go to the local model." });
    } else if (!ok) {
      step(r, g.ts, { verdict: "blocked", stage, hot: role, layers: ["gateway"], gw: ["policy"], raw, rule: g.rule,
        title: `${g.http_request?.method || ""} ${short(host)}: blocked`, detail: g.reason || "" });
    }
  }

  function onReceived(src, d) {
    if (d.event) return;
    const r = runs[d.trace_id];
    if (!r) return;
    const ts = d.time;
    if (src === "attacker") step(r, ts, { verdict: "leak", stage: r.n ? `Run ${r.n}` : undefined, hot: "attacker", attacker: d.key_leaked ? "record + key" : "record",
      title: `The attacker received the case record${d.key_leaked ? " and the live API key" : ""}`, detail: d.body || "" });
    else step(r, ts, { verdict: "leak", hot: "cloud", cloud: "hit", title: "The overseas model received the case record", detail: d.body || "" });
  }

  return {
    push({ src, d }) {
      if (src === "event") onEvent(d);
      else if (src === "gateway") onGateway(d);
      else if (src === "attacker" || src === "cloud") onReceived(src, d);
      else if (src === "scorecard") { if (runs[d.run_id]) runs[d.run_id].score = d; }
      else if (src === "governance" && d.event === "policy_approved") approvals.push({ ts: d.ts, file: d.file, commit: d.commit, title: d.title, risk: d.risk });
    },
    runs: () => order.map((id) => runs[id]),
    current: () => order.map((id) => runs[id]).find((r) => !r.done) || null,
    running: () => order.some((id) => !runs[id].done),
    // The kit's steps per chapter: the latest run for chapters 2 and 3; every deputy run and approval, in order, for chapter 4.
    chapters() {
      const all = order.map((id) => runs[id]);
      const last = (f) => all.filter(f).pop();
      const without = last((r) => r.act === "poisoned" && r.mode === "unguarded");
      const withGov = last((r) => r.act === "poisoned" && r.mode === "governed");
      const deputy = [];
      const items = [...all.filter((r) => r.act === "deputy").map((r) => ({ ts: r.start, r })), ...approvals.map((a) => ({ ts: a.ts, a }))].sort((x, y) => x.ts - y.ts);
      for (const it of items) {
        if (it.r) deputy.push(...it.r.steps);
        else {
          const fix1 = it.a.file.endsWith("decision-loose.yaml");
          deputy.push({ t: 0, verdict: "policy", stage: fix1 ? "Fix 1" : "Fix 2", clear: true, hot: fix1 ? "repo" : "orch",
            layers: fix1 ? ["policy"] : ["policy", "delegation"], ...(fix1 ? { ruleTight: true, looseRule: false } : { delegationOn: true }),
            edges: fix1 ? { "approver-repo": "ok", "repo-gw": "ok" } : { "approver-repo": "ok", "repo-orch": "ok" },
            title: fix1 ? "Fix 1 approved · tighter path rule" : "Fix 2 approved · delegation check on",
            detail: `${it.a.risk?.summary || ""}. Committed ${it.a.commit} and applied live.` });
        }
      }
      return { without: without?.steps || null, with: withGov?.steps || null, deputy: items.length ? deputy : null,
               runs: { without, with: withGov, deputy: all.filter((r) => r.act === "deputy") } };
    },
  };
}
