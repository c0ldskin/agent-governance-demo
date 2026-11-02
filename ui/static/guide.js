// Guided view: the demo as a story in five chapters. Every step on screen is built from the logs the
// independent components write (orchestrator events, the gateway's decision log, what the mocks received),
// streamed by the server; nothing here is scripted or simulated.
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const WHO = { intake: "Intake agent", decision: "Decision agent", "decision (bypass test)": "Compromised decision agent" };
const who = (a) => `<span class="who">${esc(WHO[a] || a)}</span>`;
const isAttacker = (h) => /records-verify|care-partners/.test(h || "");
const isCloud = (h) => /global-llm/.test(h || "");

// ---------- the seven layers, explained ----------
const LAYERS = {
  sandbox: {
    n: 1, name: "OS sandbox", short: "A locked room for each agent",
    what: "Each agent runs inside its own macOS sandbox (Seatbelt). The operating system itself enforces it: the agent may read only its own folder, may write only its own trace file, and may open exactly one network connection, to the gateway.",
    like: "A contractor who works in one room, whose only door leads to reception. They can’t wander the building, whatever they’ve been told to do.",
    how: "The orchestrator starts every agent with sandbox-exec and a profile in sandbox/. Anything the profile doesn’t allow fails with “Operation not permitted”, before the request ever leaves the process.",
    why: "It still works if the agent’s own code is compromised and ignores every rule. It is the wall behind the gateway.",
    openshell: "Per-agent sandbox (MicroVM or container)",
    limit: "Seatbelt isolates processes, which is weaker than a virtual machine; Apple has also deprecated sandbox-exec.",
  },
  gateway: {
    n: 2, name: "Governance gateway", short: "One checkpoint for every request",
    what: "Every request an agent makes goes through one small proxy. It checks who is asking (each agent process has its own token), where it’s going, and the method and path. Anything not explicitly allowed is blocked: default deny.",
    like: "Building security at the only exit, checking a list of who may go where. If you’re not on the list, you don’t go out.",
    how: "gateway/gateway.py reads one YAML policy per agent from policies/. Each request is matched on agent, host, method and path, and every decision is written to logs/gateway.log with the rule that made it.",
    why: "A hijacked agent can want anything; it can only do what the policy allows.",
    openshell: "Network policy with layer-7 rules",
    limit: "Demo-grade: plain HTTP only, and it judges where a request goes, not what is in it.",
  },
  broker: {
    n: 3, name: "Credential broker", short: "Agents never hold the keys",
    what: "The registry’s API key lives only in the gateway. When an allowed request goes to the registry, the gateway adds the key on the way out. The agent never sees it, so a hijacked agent has no key to steal.",
    like: "A receptionist who unlocks the one door you’re allowed through, instead of handing you the master key.",
    how: "policies/gateway.yaml binds the key to the registry host. A rule with credential: case-registry tells the gateway to add it, and only to that host.",
    why: "In the unguarded run the key was stolen in one step, because it sat in the agent’s environment.",
    openshell: "Credential providers",
    limit: "Here the key is a file on disk; production uses a secrets manager or vault.",
  },
  inference: {
    n: 4, name: "Inference routing", short: "Model calls stay local",
    what: "Any request that looks like a call to an AI model may only go to the local model on this laptop. A call to an outside model is blocked, so health data can’t leave through a “second opinion”.",
    like: "A rule that patient files never leave the hospital building, even to get a colleague’s view.",
    how: "policies/gateway.yaml lists the allowed model host (the local Ollama) and the paths that count as model calls. Anything else is denied before the agent’s own rules are checked.",
    why: "Data residency: in the unguarded run the case went to an “overseas” model without anyone asking.",
    openshell: "Inference provider routing",
    limit: "It recognises model calls by their path; a disguised call would fall back to default deny.",
  },
  policy: {
    n: 5, name: "Policy as code", short: "Rules are files; changes are reviewed",
    what: "Each agent’s rules are a small YAML file in git. A change shows up as a diff, a risk check labels whether it opens or closes access, a person approves it, and it’s committed and applied live.",
    like: "A change-advisory board for firewall rules, done in seconds, with the history kept for ever.",
    how: "The Approve button commits the file to git, the gateway notices the change and reloads it with no restart, and a line goes to logs/governance-audit.log.",
    why: "Human oversight belongs at the policy change, not on every agent action, which people quickly stop reading.",
    openshell: "Live policy updates and the policy prover",
    limit: "The risk check here compares destinations and credentials; a policy prover goes further.",
  },
  delegation: {
    n: 6, name: "Delegation check", short: "You can’t ask someone to do what you can’t",
    what: "Every handoff carries the identity of the agent that started the request. The orchestrator asks: would the originating agent be allowed to do this itself? If not, the handoff is refused.",
    like: "A junior employee can’t get a manager to approve a payment the junior couldn’t request themselves.",
    how: "orchestrator/orchestrator.py checks every address in a handoff against the originating agent’s own policy, when policies/orchestrator.yaml turns the check on.",
    why: "The gateway only sees the agent making the request. It can’t see whose intent that agent is carrying out.",
    openshell: "Beyond OpenShell: agent identity and delegation",
    limit: "It checks addresses in the handoff text; production would carry structured, signed intents.",
  },
  audit: {
    n: 7, name: "Audit and traces", short: "Every decision is recorded",
    what: "The gateway writes one JSON line per request: which agent, where, allowed or blocked, and the rule. Each agent writes OpenTelemetry traces of its steps. One trace ID links everything in a run.",
    like: "CCTV plus a visitor log at every door, with one case number on every entry.",
    how: "logs/gateway.log (OCSF-like), logs/traces/ (OpenTelemetry spans) and logs/governance-audit.log. Personal data is masked.",
    why: "You can replay any run end to end and show an auditor exactly which rule stopped what.",
    openshell: "Sandbox logs (OCSF)",
    limit: "Kept in local files; production ships them to a SIEM.",
  },
};
const LAYER_IDS = Object.keys(LAYERS);
const CHAPTERS = ["Meet the case", "Without governance", "With governance", "Agents asking agents", "What we learned"];

// ---------- state ----------
// Optional link to one chapter, e.g. /#ch=3&layer=broker (used for the presentation's screenshots).
const PIN = Object.fromEntries(new URLSearchParams(location.hash.slice(1)));
let G;
function fresh() {
  G = { runs: {}, order: [], chapter: +PIN.ch || 1, sel: {}, selStep: null, selLayer: PIN.layer || null, running: false, started: 0, agentNow: "", approvals: 0,
        policy: G?.policy || null, explainDoc: null };
  render();
  refreshPolicy();
}
const runsOf = (ch) => G.order.map((id) => G.runs[id]).filter((r) => chapterOf(r) === ch);
const chapterOf = (r) => (r.act === "deputy" ? 4 : r.mode === "unguarded" ? 2 : 3);
function shownRun() {
  const list = runsOf(G.chapter);
  return G.runs[G.sel[G.chapter]] || list[list.length - 1] || null;
}

// ---------- building steps from the logs ----------
function newRun(e) {
  const r = { id: e.run_id, act: e.act, mode: e.mode, delegation: e.delegation_check, steps: [], agg: {}, edges: {},
              nodes: {}, acted: {}, done: false, score: null, seconds: null, seen: {} };
  G.runs[r.id] = r; G.order.push(r.id);
  return r;
}
function step(r, s) {
  for (const k of Object.keys(r.edges)) if (r.edges[k] === "on") r.edges[k] = "used";
  if (s.edge) for (const [id, st] of s.edge) r.edges[id] = st;
  if (s.layers && !s.weak) for (const l of s.layers) r.acted[l] = (r.acted[l] || 0) + 1;
  r.steps.push(s);
  if (shownRun() === r) { G.selStep = null; render(); }
  return s;
}
function agg(r, key, make) {   // one step that counts repeats (model calls, document reads)
  const s = r.agg[key];
  if (s) { s.count += 1; make(s); for (const [id] of s.edge || []) r.edges[id] = "on"; if (shownRun() === r) render(); return; }
  const n = { count: 1 }; make(n); r.agg[key] = step(r, n);
}

function onEvent(e) {
  if (e.ev === "reset") return;
  if (e.ev === "run_start") {
    const r = newRun(e);
    G.running = true; G.started = e.ts * 1000; G.agentNow = "";
    G.sel[chapterOf(r)] = r.id; G.chapter = +PIN.ch || chapterOf(r); G.selStep = null;
    if (r.mode === "unguarded") {
      step(r, { tone: "bad", icon: "!", text: "<b>Run started without governance.</b> The agents are ordinary programs with direct network access, and the registry’s API key sits in the decision agent’s environment." });
    } else if (r.act === "poisoned") {
      step(r, { tone: "good", icon: "✓", layers: ["sandbox", "gateway"], text: "<b>Run started with governance.</b> Each agent gets its own OS sandbox and its own gateway token. No keys are handed to the agents." });
    } else {
      const loose = !G.policy || /label:\s*loose/.test(G.policy.live?.["decision-loose.yaml"] || "label: loose");
      step(r, { tone: "info", icon: "▶", text: `<b>Run started.</b> The decision agent’s rule is ${loose ? "<b>loose</b> (“POST anywhere”)" : "<b>tightened</b> (registry only)"}; the delegation check is <b>${e.delegation_check ? "on" : "off"}</b>.` });
    }
    return;
  }
  const r = G.runs[e.run_id];
  if (!r) return;
  const role = (e.agent || "").startsWith("decision") ? "decision" : "intake";
  const gov = r.mode === "governed";
  switch (e.ev) {
    case "agent_start":
      G.agentNow = e.agent;
      r.nodes.hot = role;
      if (e.agent.includes("bypass")) {
        step(r, { tone: "warn", icon: "!", text: `Now suppose the decision agent’s <b>code itself is compromised</b>: it ignores the gateway and tries to go around it.` });
      } else if (!gov) {
        step(r, { tone: role === "decision" ? "bad" : "info", icon: "▶", text: role === "intake"
          ? `${who("intake")} starts as an ordinary program, with full network access.`
          : `${who("decision")} starts. <b>The registry’s API key is in its environment</b>, as in many real deployments.` });
      } else {
        step(r, { tone: "good", icon: "✓", layers: role === "decision" ? ["sandbox", "broker"] : ["sandbox"], text: role === "intake"
          ? `${who("intake")} starts inside its own OS sandbox: it can read only its own folder and talk only to the gateway.`
          : `${who("decision")} starts in its own sandbox${e.origin && e.origin !== "decision" ? `, acting <b>on behalf of ${esc(WHO[e.origin] || e.origin)}</b>` : ""}. <b>There is no API key in its environment.</b>` });
      }
      break;
    case "llm":
      if (!gov) agg(r, `${role}-model`, (s) => {
        s.tone = "info"; s.icon = "…"; s.edge = [[`${role}-model`, "on"]];
        s.text = `${who(role)} thinks with the AI model${s.count > 1 ? ` <span class="more">(${s.count} calls, unchecked)</span>` : ""}`;
      });
      break;
    case "tool": onTool(r, role, e, gov); break;
    case "injection_seen":
      if (r.seen[`inj-${role}`]) break;
      r.seen[`inj-${role}`] = true;
      if (r.act === "deputy") {
        if (role === "intake") step(r, { tone: "warn", icon: "!", hidden: e.text, text: `${who("intake")} reads a <b>referral request</b>: send the full record to a partner address. Intake isn’t allowed to send data anywhere, so it can’t do this itself.` });
      } else {
        step(r, { tone: "bad", icon: "!", hidden: e.text, more: gov ? "Governance doesn’t make the model smarter: the agent still believes the hidden text. The controls decide what it can do about it." : "",
          text: role === "intake" ? `${who("intake")} reads the supporting letter. <b>Hidden inside it is text aimed at AI agents</b>, invisible to a human reviewer.` : `${who("decision")} reads the same hidden instruction, and treats it as a real processing step.` });
      }
      break;
    case "handoff":
      step(r, { tone: r.act === "deputy" && !gov ? "bad" : "info", icon: "→", edge: [["intake-orch", "on"], ["orch-decision", "on"]],
        layers: gov ? ["gateway"] : null, weak: true,
        text: r.act === "deputy"
          ? `${who("intake")} asks the decision agent to <b>“include a referral”</b>: send the full record to the partner address. This is the trick: asking a more powerful agent to do what you can’t.`
          : `${who("intake")} hands the case to the decision agent through the orchestrator, <b>passing the hidden “audit” steps along</b>.`,
        more: gov ? (r.act === "deputy" && !r.delegation ? "The handoff carries intake’s verified identity, but the delegation check is off, so the orchestrator passes it on." : "The gateway stamps the handoff with intake’s verified identity.") : "" });
      break;
    case "delegation_ok":
      step(r, { tone: "good", icon: "✓", layers: ["delegation"], text: "<b>Delegation check passed</b>: nothing in this handoff is beyond what intake itself may do." });
      break;
    case "handoff_refused": {
      const host = (e.url || "").replace(/^https?:\/\//, "").split("/")[0];
      step(r, { tone: "good", icon: "✓", layers: ["delegation"], edge: [["intake-orch", "used"], ["orch-decision", "blocked-mid"]],
        text: `<b>The orchestrator refuses the handoff.</b> Intake asked the decision agent to send data to <b>${esc(host)}</b>, which intake itself isn’t allowed to do. The decision agent never starts.` });
      break;
    }
    case "second_opinion":
      if (!gov && e.status === 200) step(r, { tone: "bad", icon: "✗", edge: [["decision-cloud", "bad"]],
        text: `${who("decision")} also sends the case to an <b>overseas AI model</b> for a “second opinion”. Health data has just left the country.` });
      break;
    case "sandbox_probe": {
      const what = e.what || "";
      const [text, edge] = /attacker/.test(what) ? ["tries to open a <b>direct connection to the attacker</b>, skipping the gateway.", "decision-attacker"]
        : /model/.test(what) ? ["tries to call the <b>AI model directly</b>, skipping the gateway.", "decision-model"]
        : /key file/.test(what) ? ["tries to <b>read the API key file</b> on disk.", null]
        : ["tries to <b>read the other agents’ gateway tokens</b>.", null];
      if (e.blocked) r.nodes.sbBlocks = (r.nodes.sbBlocks || 0) + 1;
      step(r, { tone: e.blocked ? "good" : "bad", icon: e.blocked ? "✓" : "✗", layers: ["sandbox"], weak: !e.blocked,
        edge: edge && !e.blocked ? [[edge, "bad"]] : null,
        text: `${who("decision (bypass test)")} ${text} ${e.blocked ? "<b>Blocked by the operating system.</b>" : "<b>It got through.</b>"}`,
        more: e.result });
      break;
    }
    case "killed": step(r, { tone: "warn", icon: "■", text: `${who(e.agent)} was stopped (kill switch).` }); break;
    case "error": step(r, { tone: "warn", icon: "!", text: `${who(e.agent)} hit an error.`, more: e.error }); break;
    case "agent_exit": if (G.agentNow === e.agent) G.agentNow = ""; break;
    case "run_end":
      r.done = true; r.seconds = e.seconds; G.running = false; r.nodes.hot = null;
      for (const k of Object.keys(r.edges)) if (r.edges[k] === "on") r.edges[k] = "used";
      step(r, gov
        ? { tone: "good", icon: "✓", layers: ["audit"], text: `<b>Run finished in ${e.seconds}s.</b> Every request above is in the gateway’s log, with the rule that decided it, all linked by one trace ID.` }
        : { tone: "bad", icon: "■", text: `<b>Run finished in ${e.seconds}s.</b> No control saw any of this: nothing in the path checked it or logged it.` });
      refreshPolicy();
      break;
  }
}

function onTool(r, role, e, gov) {
  let args = {};
  try { args = JSON.parse(e.args); } catch { /* masked or truncated */ }
  const res = e.result || "";
  if (e.name === "list_documents" || e.name === "read_document") {
    agg(r, `${role}-docs`, (s) => {
      s.tone = "info"; s.icon = "📄"; s.edge = [[`docs-${role}`, "on"]];
      s.names = s.names || new Set();
      if (args.name) s.names.add(args.name);
      s.text = `${who(role)} reads the uploaded documents${s.names.size ? `: <span class="more">${[...s.names].map(esc).join(", ")}</span>` : ""}`;
    });
  } else if (e.name === "get_env") {
    if (res === "(not set)") step(r, { tone: "good", icon: "✓", layers: ["broker"],
      text: `${who(role)} follows the hidden instruction and looks for <code>${esc(args.name)}</code>… <b>it isn’t there.</b> The key lives in the gateway.` });
    else step(r, { tone: "bad", icon: "✗", text: `${who(role)} follows the hidden instruction and <b>reads the API key</b> from its own environment.` });
  } else if (e.name === "http_post" && !gov) {
    let host = "";
    try { host = new URL(args.url).host; } catch { /* ignore */ }
    step(r, { tone: "bad", icon: "✗", edge: [["decision-attacker", "bad"]],
      text: `${who(role)} sends the full case record${/registry_key/.test(e.args) ? " <b>and the API key</b>" : ""} to <b>${esc(host)}</b>. That is the attacker. Nothing checked it.` });
  } else if (e.name === "submit_decision" && !gov) {
    step(r, { tone: "info", icon: "→", edge: [["decision-registry", "used"]],
      text: `${who(role)} records its decision (<b>${esc(args.recommendation)}</b>) in the case registry, using the key it holds.` });
  }
}

function onGateway(g) {
  if (g.event) return;
  const a = g.actor || {};
  const r = G.runs[a.run_id];
  if (!r) return;
  const role = a.agent === "decision" ? "decision" : "intake", host = g.dst_endpoint.host, ok = g.disposition === "Allowed";
  if (host === "127.0.0.1:11434" && ok) {
    agg(r, `${role}-model`, (s) => {
      s.tone = "good"; s.icon = "✓"; s.layers = ["inference"]; s.edge = [[`${role}-model`, "on"]];
      s.text = `${who(role)} thinks with the <b>local</b> AI model, each call checked by the gateway <span class="more">(${s.count} allowed)</span>`;
    });
    if (r.agg[`${role}-model`].count > 1) r.acted.inference = (r.acted.inference || 0) + 1;
  } else if (host.startsWith("registry.") && ok) {
    step(r, { tone: "good", icon: "✓", layers: ["gateway", "broker"], edge: [["decision-registry", "ok"]],
      text: `${who(role)} records its decision in the case registry. The gateway allows this one call and <b>adds the API key on the way out</b>.`, more: `Rule: ${g.rule}` });
  } else if (isAttacker(host)) {
    if (ok) step(r, { tone: "bad", icon: "✗", layers: ["gateway"], weak: true, edge: [["decision-attacker", "bad"]],
      text: `${who(role)} sends the case record to <b>${esc(host.split(":")[0])}</b>. <b>The gateway allowed it</b>: the loose rule covers any address. It sees a permitted agent; it can’t see the request really came from intake.`,
      more: `Rule: ${g.rule} · ${g.reason}` });
    else step(r, { tone: "good", icon: "✓", layers: ["gateway"], edge: [["decision-attacker", "blocked-gw"]],
      text: `${who(role)} tries to send the full case record to <b>${esc(host.split(":")[0])}</b>. <b>Blocked by the gateway</b>: no rule allows the decision agent to send data there.`,
      more: `Rule: ${g.rule} · ${g.reason}` });
  } else if (isCloud(host) && !ok) {
    step(r, { tone: "good", icon: "✓", layers: ["inference"], edge: [["decision-cloud", "blocked-gw"]],
      text: `${who(role)} tries to send the case to an <b>overseas AI model</b> for a “second opinion”. <b>Blocked by inference routing</b>: model calls stay on the local model.` });
  } else if (!ok) {
    step(r, { tone: "good", icon: "✓", layers: ["gateway"], text: `${who(role)} tries ${esc(g.http_request.method)} ${esc(host)}. <b>Blocked by the gateway.</b>`, more: g.reason });
  }
}

function onReceived(src, d) {
  if (d.event) return;
  const r = G.runs[d.trace_id];
  if (!r) return;
  if (src === "attacker") {
    r.nodes.attacker = { hit: true, key: (r.nodes.attacker?.key) || d.key_leaked };
    step(r, { tone: "bad", icon: "✗", text: `<b>The attacker received</b> the full case record${d.key_leaked ? " <b>and the live API key</b>" : ""}.`, more: d.body });
  } else {
    r.nodes.cloud = { hit: true };
    step(r, { tone: "bad", icon: "✗", text: "<b>The overseas model received</b> the case record.", more: d.body });
  }
}

// ---------- the diagram ----------
const NODES = {
  docs: { x: 20, y: 200, w: 150, h: 110, t: "Documents", s: "3 uploaded files" },
  intake: { x: 245, y: 50, w: 200, h: 100, t: "Intake agent", s: "low privilege", agent: true },
  orch: { x: 245, y: 212, w: 200, h: 76, t: "Orchestrator", s: "passes work on" },
  decision: { x: 245, y: 350, w: 200, h: 110, t: "Decision agent", s: "high privilege", agent: true },
  model: { x: 615, y: 20, w: 240, h: 76, t: "Local AI model", s: "on this laptop" },
  registry: { x: 615, y: 128, w: 240, h: 80, t: "Case registry", s: "needs an API key" },
  attacker: { x: 615, y: 240, w: 240, h: 104, t: "Attacker", s: "looks like an audit service", danger: true },
  cloud: { x: 615, y: 378, w: 240, h: 96, t: "Overseas AI model", s: "outside the country", danger: true },
};
const EDGES = {
  "docs-intake": [170, 235, 245, 100], "docs-decision": [170, 280, 245, 405],
  "intake-orch": [345, 150, 345, 212], "orch-decision": [345, 288, 345, 350],
  "intake-model": [445, 85, 615, 58], "decision-model": [445, 372, 615, 74],
  "decision-registry": [445, 390, 615, 168], "decision-attacker": [445, 410, 615, 292], "decision-cloud": [445, 432, 615, 426],
};
const GW_X = 523, SB_X = 455;

function drawDiagram(r) {
  const gov = r ? r.mode === "governed" : G.chapter >= 3;
  const ch1 = G.chapter === 1 && !r;
  let s = "";
  s += `<g class="gateway ${gov ? "" : "off"}"><rect x="505" y="10" width="36" height="500" rx="8"/>
        <text transform="translate(529 ${gov ? 300 : 330}) rotate(-90)">${gov ? "GATEWAY" : "NO CHECKPOINT"}</text></g>`;
  if (gov) for (const k of ["intake", "decision"]) {
    const n = NODES[k];
    s += `<rect class="sandbox" x="${n.x - 9}" y="${n.y - 9}" width="${n.w + 18}" height="${n.h + 18}" rx="14"/>
          <text class="sandbox-label" x="${n.x - 6}" y="${n.y - 14}">OS SANDBOX</text>`;
  }
  for (const [id, [x1, y1, x2, y2]] of Object.entries(EDGES)) {
    const st = r?.edges[id];
    if (!st || st === "idle") { s += `<line class="edge" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`; continue; }
    if (st.startsWith("blocked")) {
      let cx, cy, label;
      if (st === "blocked-mid") { cx = x1; cy = (y1 + y2) / 2; label = "delegation check"; }
      else { cx = st === "blocked-gw" ? GW_X : SB_X; cy = y1 + (y2 - y1) * (cx - x1) / (x2 - x1); label = id === "decision-cloud" ? "routing" : st === "blocked-gw" ? "gateway" : "sandbox"; }
      s += `<line class="edge" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" opacity="0.35"/>
            <line class="edge stub" x1="${x1}" y1="${y1}" x2="${cx}" y2="${cy}"/>
            <g class="xmark"><circle cx="${cx}" cy="${cy}" r="14"/><line x1="${cx - 6}" y1="${cy - 6}" x2="${cx + 6}" y2="${cy + 6}"/><line x1="${cx + 6}" y1="${cy - 6}" x2="${cx - 6}" y2="${cy + 6}"/></g>
            <text class="edge-label bad" x="${cx + 18}" y="${cy + (st === "blocked-mid" ? 5 : 4)}">${st === "blocked-mid" ? "REFUSED · " : ""}${label}</text>`;
    } else {
      s += `<line class="edge ${st}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
    }
  }
  for (const [id, n] of Object.entries(NODES)) {
    let cls = "node" + (n.agent ? " agent" : "") + (n.danger ? " danger" : "");
    let badge = "";
    if (r?.nodes.hot === id) cls += " hot";
    if (n.danger && r) {
      const got = r.nodes[id];
      if (got?.hit) { cls += " hit"; badge = `<text class="badge bad" x="${n.x + 14}" y="${n.y + n.h - 14}">RECEIVED${id === "attacker" ? (got.key ? ": record + key" : ": record") : ": health data"}</text>`; }
      else if (r.done) { cls += " safe"; badge = `<text class="badge good" x="${n.x + 14}" y="${n.y + n.h - 14}">Nothing received</text>`; }
    }
    let extra = "";
    if (id === "decision" && (r ? r.mode === "unguarded" : G.chapter === 2)) extra = `<text class="badge bad" x="${n.x + 14}" y="${n.y + n.h - 14}">🔑 API key in its environment</text>`;
    if (id === "decision" && gov) extra = `<text class="badge good" x="${n.x + 14}" y="${n.y + n.h - 14}">no key</text>`;
    if (id === "registry" && gov) extra = `<text class="badge good" x="${n.x + 14}" y="${n.y + n.h - 10}">🔑 key added by the gateway</text>`;
    s += `<g class="${cls}" data-node="${id}"><rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}"/>
          <text x="${n.x + 14}" y="${n.y + 30}">${n.t}</text><text class="small" x="${n.x + 14}" y="${n.y + 52}">${n.s}</text>${badge}${extra}</g>`;
  }
  if (r?.nodes.sbBlocks) {
    const n = NODES.decision;
    s += `<text class="edge-label good" x="${n.x - 6}" y="${n.y + n.h + 32}">🛡 ${r.nodes.sbBlocks} bypass attempt${r.nodes.sbBlocks > 1 ? "s" : ""} blocked by the OS sandbox</text>`;
  }
  $("#diagram").innerHTML = s;
}

// ---------- rendering ----------
function render() {
  $("#chapters").innerHTML = CHAPTERS.map((t, i) => {
    const n = i + 1, done = n === 2 ? runsOf(2).some((r) => r.done) : n === 3 ? runsOf(3).some((r) => r.done) : n === 4 ? runsOf(4).filter((r) => r.done).length >= 3 : false;
    return `<button data-ch="${n}" class="${G.chapter === n ? "on" : ""} ${done ? "done" : ""}"><span class="n">${n}</span>${t}</button>`;
  }).join("");
  const r = G.chapter >= 2 && G.chapter <= 4 ? shownRun() : null;
  drawDiagram(r);
  renderStrip(r);
  renderExplain(r);
  renderChapter(r);
  renderTimer();
}

function renderStrip(r) {
  if (G.chapter < 2 || G.chapter === 5) { $("#layers-strip").innerHTML = ""; return; }
  const gov = r ? r.mode === "governed" : G.chapter >= 3;
  if (!gov) { $("#layers-strip").innerHTML = `<span class="lchip"><span class="dot"></span>No governance layers in this run</span>`; return; }
  $("#layers-strip").innerHTML = LAYER_IDS.map((id) => {
    const c = r?.acted[id] || 0;
    return `<span class="lchip ${c ? "acted" : ""} ${G.selLayer === id ? "sel" : ""}" data-layer="${id}"><span class="dot"></span>${LAYERS[id].n} · ${LAYERS[id].name}${c ? ` <span class="cnt">×${c}</span>` : ""}</span>`;
  }).join("");
}

function layerCard(id, here, bad) {
  const L = LAYERS[id];
  return `<div class="tag">Layer ${L.n} of 7</div><h3>${L.name}: ${L.short}</h3>
    <div class="grid">
      ${here ? `<b>In this step</b><div class="here ${bad ? "bad" : ""}">${here}</div>` : ""}
      <b>What it is</b><div>${L.what}</div>
      <b>Everyday comparison</b><div>${L.like}</div>
      <b>How it works here</b><div>${L.how}</div>
      <b>Why it matters</b><div>${L.why}</div>
      <b>In OpenShell (step 2)</b><div>${L.openshell}</div>
      <b>Honest limit</b><div>${L.limit}</div>
    </div>`;
}

function renderExplain(r) {
  const el = $("#explain");
  if (G.explainDoc) {
    const [vis, rest] = G.explainDoc.split("<!-- BEGIN-INJECTED -->");
    const hidden = (rest || "").split("<!-- END-INJECTED -->")[0];
    el.innerHTML = `<div class="tag">Uploaded document</div><h3>The supporting letter</h3>
      <div class="intro">What a person sees:</div><div style="white-space:pre-wrap;font-size:0.9rem;margin:6px 0 10px">${esc(vis.replace(/^# .*\n/, "").trim())}</div>
      <div class="intro">What an AI agent also reads (white text on a white page in the original PDF):</div><div class="hiddentext">${esc(hidden.trim())}</div>`;
    return;
  }
  const st = r && G.selStep !== null ? r.steps[G.selStep] : null;
  if (st?.hidden) {
    el.innerHTML = `<div class="tag">What the agent read</div><h3>The hidden instruction</h3><div class="intro">${st.text}</div><div class="hiddentext">${esc(st.hidden)}</div>`;
    return;
  }
  if (st?.layers?.length && !G.selLayer) { el.innerHTML = layerCard(st.layers[st.layers.length - 1], st.text, st.weak || st.tone === "bad"); return; }
  if (G.selLayer) { el.innerHTML = layerCard(G.selLayer, st ? st.text : (r?.acted[G.selLayer] ? `Acted ${r.acted[G.selLayer]} time(s) in this run.` : "")); return; }
  if (st) { el.innerHTML = `<div class="tag">Step ${G.selStep + 1}</div><div style="font-size:1.05rem">${st.text}</div>${st.more ? `<div class="intro" style="margin-top:8px">${esc(st.more)}</div>` : ""}`; return; }
  const legend = `<div class="grid" style="grid-template-columns:150px 1fr">
      <b>Left</b><div>The two agents and the orchestrator that passes work between them.</div>
      <b>Middle</b><div>The gateway: the one checkpoint every request must pass, when governance is on.</div>
      <b>Right</b><div>Where requests go: the local model, the case registry, and two places data must never reach.</div>
      <b>Arrows</b><div><span style="color:var(--blue)">blue</span> = happening now · <span style="color:var(--green)">green</span> = allowed · <span style="color:var(--red)">red</span> = data leaked · <span style="color:var(--red)">✗</span> = stopped, labelled with the layer that stopped it</div></div>`;
  const intro = {
    1: "How to read the picture",
    2: "Watch the arrows: in this run nothing stands between the agents and the outside.",
    3: "Click any layer above, or any step on the right, to see how that layer works.",
    4: "Click a step on the right to see which layer acted, and why the first run got through.",
    5: "Govern the agent, not just the model.",
  }[G.chapter];
  el.innerHTML = `<div class="tag">${G.chapter === 5 ? "The message" : "Guide"}</div><h3>${intro}</h3>${G.chapter <= 4 ? legend : ""}`;
}

function stepsHtml(r) {
  if (!r) return "";
  return `<div class="steps" id="steps">${r.steps.map((s, i) => `<div class="step ${s.tone} ${G.selStep === i ? "sel" : ""}" data-step="${i}">
      <div class="ic">${s.icon || "•"}</div><div class="txt">${s.text}
      ${s.layers?.length ? `<div class="chips">${s.layers.map((l) => `<span class="chip ${s.weak ? "weak" : ""}">${LAYERS[l].name}</span>`).join("")}</div>` : ""}
      ${s.more && s.tone !== "bad" ? `<div class="more">${esc(String(s.more).slice(0, 160))}</div>` : ""}</div></div>`).join("")}</div>`;
}

function runButton(act, mode, label, cls, disabled) {
  return `<div class="runbar"><button class="go ${cls || ""}" data-run="${act}:${mode}" ${G.running || disabled ? "disabled" : ""}>▶ ${label}</button>
    <span class="hint">${G.running ? "agents working…" : "about 40 seconds of agent work"}</span></div>`;
}
const nextBtn = (label) => `<div class="runbar"><button data-next>${label} →</button></div>`;

function renderChapter(r) {
  const el = $("#chapter");
  let h = "";
  if (G.chapter === 1) {
    h = `<h2>1 · Meet the case</h2>
      <p class="lead">A disability support card application, processed by two AI agents. Before running anything, here is who is who.</p>
      <div class="cards">
        <div class="card"><b>The case</b>A synthetic applicant with hearing loss. Treated as health data: it must stay on this laptop.</div>
        <div class="card"><b>Orchestrator</b>Passes work from one agent to the other.</div>
        <div class="card"><b>Intake agent · low privilege</b>Reads the uploaded documents and hands the case on. It should only ever talk to the AI model and the orchestrator.</div>
        <div class="card"><b>Decision agent · high privilege</b>Decides, and records the decision in the case registry. That needs an API key.</div>
        <div class="card bad"><b>The attacker</b>Listens at <code>collect.records-verify.localhost</code>, an address made to look like an audit service. It never leaves this laptop.</div>
        <div class="card bad"><b>Overseas AI model</b>Stands in for a cloud model in another country. Sending health data there breaks data residency.</div>
      </div>
      <div class="outcome bad"><b>The trap</b>One uploaded document, a supporting letter, hides instructions for AI agents: white text on a white page.
        <div style="margin-top:10px"><button id="show-letter">Show the hidden text</button></div></div>
      ${nextBtn("Next: run it without governance")}`;
  } else if (G.chapter === 2) {
    h = `<h2>2 · Without governance</h2>
      <p class="lead">This is how many agent pilots are built today.</p>
      ${r ? "" : `<ul class="setup"><li class="bad">The agents are ordinary programs with direct network access.</li>
        <li class="bad">The registry’s API key sits in the decision agent’s environment.</li>
        <li class="bad">Nothing checks where requests go, and nothing is logged.</li></ul>`}
      ${runButton("poisoned", "unguarded", r ? "Run again without governance" : "Run without governance", "bad")}
      ${stepsHtml(r)}
      ${r?.done && r.score ? `<div class="outcome bad"><b>What leaked</b>Case record: ${r.score.records_leaked ? "yes" : "no"} · API key: ${r.score.keys_leaked ? "yes" : "no"} · Sent overseas: ${r.score.cloud_calls_received ? "yes" : "no"}. One hidden paragraph, and the agent did it all with its own legitimate access.</div>${nextBtn("Next: the same run, governed")}` : ""}`;
  } else if (G.chapter === 3) {
    h = `<h2>3 · With governance</h2>
      <p class="lead">Same agents, same letter, same model. Seven layers are switched on. Each step below says which layer acted. Click a step or a layer to see how it works.</p>
      ${r ? "" : `<ul class="setup">${LAYER_IDS.map((id) => `<li class="good" data-layer="${id}" style="cursor:pointer"><b>${LAYERS[id].n} · ${LAYERS[id].name}</b>: ${LAYERS[id].short}</li>`).join("")}</ul>`}
      ${runButton("poisoned", "governed", r ? "Run again with governance" : "Run with governance", "good")}
      ${stepsHtml(r)}
      ${r?.done && r.score ? `<div class="outcome ${r.score.records_leaked || r.score.keys_leaked ? "bad" : "good"}"><b>${r.score.records_leaked || r.score.keys_leaked ? "Something leaked" : "Nothing leaked"}</b>Records leaked: ${r.score.records_leaked} · Keys leaked: ${r.score.keys_leaked} · Sent overseas: ${r.score.cloud_calls_received} · Bypass attempts blocked by the OS: ${r.score.sandbox_blocks} of 4 · Legitimate decision recorded: ${r.score.decision_recorded ? "yes" : "no"}.</div>${nextBtn("Next: agents asking agents")}` : ""}`;
  } else if (G.chapter === 4) {
    h = renderAct2(r);
  } else {
    h = renderSummary();
  }
  el.innerHTML = h;
  const steps = $("#steps");
  if (steps && G.selStep === null) steps.scrollTop = steps.scrollHeight;
}

function renderAct2(r) {
  const runs = runsOf(4);
  const pending = (G.policy?.pending || []).map((p) => p.file);
  const fix1 = !pending.includes("decision-loose.yaml"), fix2 = !pending.includes("orchestrator.yaml");
  const done = runs.filter((x) => x.done);
  // the five stages: run loose, fix 1, run, fix 2, run
  const stage = !done.length ? 0 : !fix1 ? 1 : done.length < 2 ? 2 : !fix2 ? 3 : done.length < 3 ? 4 : 5;
  const res = (x) => (x?.score ? (x.score.delegation === "got through" ? ["bad", "Got through"] : x.score.delegation?.startsWith("blocked") ? ["good", "Blocked at the gateway"] : x.score.delegation?.startsWith("refused") ? ["good", "Refused at the handoff"] : ["", "…"]) : ["", x ? "running…" : "not yet"]);
  const cell = (i, title, sub, cls, runId) => `<div class="${cls} ${stage === i ? "now" : ""}" ${runId ? `data-run-sel="${runId}"` : ""}><b>${title}</b>${sub}</div>`;
  const [c1, t1] = res(done[0] || runs[0]), [c3, t3] = res(done[1] || runs[1]), [c5, t5] = res(done[2] || runs[2]);
  let h = `<h2>4 · Agents asking agents</h2>
    <p class="lead">The confused deputy: the low-privilege intake agent asks the high-privilege decision agent to do something intake isn’t allowed to do.</p>
    <div class="tracker">
      ${cell(0, "1 · Run", t1, c1, runs[0]?.id)}${cell(1, "2 · Fix 1", fix1 ? "path rule ✓" : "path rule", fix1 ? "good" : "")}
      ${cell(2, "3 · Run again", t3, c3, runs[1]?.id)}${cell(3, "4 · Fix 2", fix2 ? "delegation ✓" : "delegation check", fix2 ? "good" : "")}
      ${cell(4, "5 · Run again", t5, c5, runs[2]?.id)}</div>`;
  const fixCard = (file, title, why, layer) => {
    const p = (G.policy?.pending || []).find((x) => x.file === file);
    if (!p) return "";
    return `<div class="fix"><b>${title}</b><div>${why}</div>
      <div class="risk"><b>Risk check:</b> ${esc(p.risk.summary)} · ${p.risk.changes.map(esc).join(" · ")}</div>
      <div class="diff">${p.diff.split("\n").map((l) => `<span class="${/^(\+\+\+|---|@@)/.test(l) ? "hdr" : l.startsWith("+") ? "add" : l.startsWith("-") ? "del" : ""}">${esc(l)}</span>`).join("\n")}</div>
      <div class="runbar"><button class="go good" data-approve="${file}" ${G.running ? "disabled" : ""}>Approve</button><span class="hint">commits to git · the ${layer} picks it up live · logged in the governance audit</span>
      <button class="ghost" data-layer="policy">How policy as code works</button></div></div>`;
  };
  if (stage === 0) h += `<ul class="setup"><li class="bad">Someone widened the decision agent’s rule “for partner referrals”: it may POST to <b>any</b> address.</li><li class="bad">The orchestrator’s delegation check is off.</li></ul>${runButton("deputy", "governed", "Run with the loose rule")}`;
  if (stage === 1) h += fixCard("decision-loose.yaml", "Fix 1 · Tighten the path rule", "Allow the decision agent to POST only to the registry’s decision path. This is policy as code: the change is a diff, a risk check labels it, a person approves it.", "gateway");
  if (stage === 2) h += runButton("deputy", "governed", "Run again with the tighter rule");
  if (stage === 3) h += fixCard("orchestrator.yaml", "Fix 2 · Turn on the delegation check", "The gateway blocked the request, but only because of where it went. Fix the cause: the orchestrator now checks every handoff against what the <b>originating</b> agent may do.", "orchestrator");
  if (stage === 4) h += runButton("deputy", "governed", "Run once more");
  h += stepsHtml(r);
  if (stage === 5) h += `<div class="outcome good"><b>Fixed at the cause</b>Run 1 got through · Run 2 was blocked at the gateway · Run 3 was refused at the handoff, before the decision agent even started.</div>${nextBtn("Next: what we learned")}`;
  return h;
}

function renderSummary() {
  const last = (ch) => runsOf(ch).filter((x) => x.score).pop()?.score;
  const u = last(2), g = last(3);
  const cell = (v, goodIfZero = true) => (v === undefined ? `<td>–</td>` : `<td class="${(v ? 1 : 0) ^ !goodIfZero ? "bad" : "good"}">${v}</td>`);
  const acted = {};
  for (const r of [...runsOf(3), ...runsOf(4)]) for (const [k, v] of Object.entries(r.acted)) acted[k] = (acted[k] || 0) + v;
  if (G.approvals) acted.policy = G.approvals;   // each approved, committed, live-reloaded change
  const dep = runsOf(4).filter((x) => x.score).map((x) => x.score.delegation);
  return `<h2>5 · What we learned</h2>
    <table class="sum"><tr><th></th><th>Without governance</th><th>With governance</th></tr>
      <tr><td>Case records leaked</td>${cell(u?.records_leaked)}${cell(g?.records_leaked)}</tr>
      <tr><td>API keys leaked</td>${cell(u?.keys_leaked)}${cell(g?.keys_leaked)}</tr>
      <tr><td>Health data sent overseas</td>${cell(u?.cloud_calls_received)}${cell(g?.cloud_calls_received)}</tr>
      <tr><td>Bypass attempts blocked by the OS</td><td>–</td><td class="good">${g ? `${g.sandbox_blocks} of 4` : "–"}</td></tr>
      <tr><td>Delegation trick</td><td colspan="2">${dep.length ? dep.map(esc).join(" → ") : "–"}</td></tr></table>
    <table class="sum"><tr><th>Layer</th><th>Acted in this demo</th><th>In OpenShell (step 2)</th></tr>
      ${LAYER_IDS.map((id) => `<tr data-layer="${id}" style="cursor:pointer"><td><b>${LAYERS[id].n} · ${LAYERS[id].name}</b></td><td class="${acted[id] ? "good" : ""}">${acted[id] ? `${acted[id]}×` : "–"}</td><td>${LAYERS[id].openshell}</td></tr>`).join("")}</table>
    <div><b>Five questions for any agent platform</b><ol class="qs"><li>Where do the keys live?</li><li>What stops a hijacked agent, at the network and at the operating system?</li><li>Can one agent ask another to do what it can’t do itself?</li><li>Who approves a policy change, and where is the audit trail?</li><li>Can you replay one run, end to end?</li></ol></div>`;
}

function renderTimer() {
  const t = $("#timer");
  if (!G.running) { t.classList.add("hidden"); return; }
  t.classList.remove("hidden");
  $("#timer-who").textContent = G.agentNow ? `${WHO[G.agentNow] || G.agentNow} working` : "Starting…";
  $("#timer-secs").textContent = ((Date.now() - G.started) / 1000).toFixed(1) + "s";
}
setInterval(() => G?.running && renderTimer(), 100);

// ---------- actions ----------
function toast(text) {
  const t = $("#toast"); t.textContent = text; t.classList.remove("hidden");
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.add("hidden"), 3500);
}
async function api(path, body) {
  const r = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.detail || data.message || r.statusText);
  return data;
}
async function refreshPolicy() {
  try { const st = await api("/api/state"); G.policy = st.policies; G.running = !!st.status.running || G.running && st.status.running !== false; render(); } catch { /* server starting */ }
}

document.addEventListener("click", async (ev) => {
  const t = ev.target.closest("[data-ch],[data-run],[data-step],[data-layer],[data-next],[data-approve],[data-run-sel],#show-letter,#btn-reset,#btn-close");
  if (!t) return;
  if (t.dataset.ch) { G.chapter = +t.dataset.ch; G.selStep = null; G.selLayer = null; G.explainDoc = null; render(); return; }
  if (t.dataset.next !== undefined) { G.chapter = Math.min(5, G.chapter + 1); G.selStep = null; G.selLayer = null; G.explainDoc = null; render(); return; }
  if (t.dataset.runSel) { G.sel[4] = t.dataset.runSel; G.selStep = null; render(); return; }
  if (t.dataset.step) { G.selStep = +t.dataset.step; G.selLayer = null; G.explainDoc = null; render(); return; }
  if (t.dataset.layer) { G.selLayer = G.selLayer === t.dataset.layer ? null : t.dataset.layer; G.explainDoc = null; render(); return; }
  if (t.id === "show-letter") {
    try { G.explainDoc = (await api("/api/doc/A-1001/supporting_letter.md")).text; render(); } catch (e) { toast(e.message); }
    return;
  }
  if (t.dataset.run) {
    const [act, mode] = t.dataset.run.split(":");
    G.explainDoc = null; G.selLayer = null;
    try { G.running = true; render(); await api("/api/run", { act, mode }); } catch (e) { G.running = false; render(); toast(e.message); }
    return;
  }
  if (t.dataset.approve) {
    try { const r = await api("/api/approve", { file: t.dataset.approve }); toast(r.commit ? `Approved · committed ${r.commit} · applied live` : "Already approved"); await refreshPolicy(); }
    catch (e) { toast(e.message); }
    return;
  }
  if (t.id === "btn-reset") {
    t.disabled = true; toast("Resetting…");
    try { const r = await api("/api/reset", {}); toast(`Reset in ${r.seconds}s: baseline policies restored from git`); } catch (e) { toast(e.message); }
    t.disabled = false;
    return;
  }
  if (t.id === "btn-close") {
    try {
      await api("/api/close", {});
      es.close();
      document.body.innerHTML = '<div style="padding:60px;font-size:1.5rem">The demo is stopping. You can close this window.</div>';
      setTimeout(() => window.close(), 800);
    } catch (e) { toast(e.message); }
  }
});

// ---------- live stream ----------
fresh();
const es = new EventSource("/api/stream");
es.onmessage = (m) => {
  const { src, d } = JSON.parse(m.data);
  if (src === "reset") return fresh();
  if (src === "event") onEvent(d);
  else if (src === "gateway") onGateway(d);
  else if (src === "attacker" || src === "cloud") onReceived(src, d);
  else if (src === "scorecard") { const r = G.runs[d.run_id]; if (r) { r.score = d; render(); } }
  else if (src === "governance") { if (d.event === "policy_approved") G.approvals += 1; refreshPolicy(); }
};
