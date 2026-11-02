// Agent Governance demo page. Everything shown comes from the components' own logs, streamed by the server.
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const AGENT = { intake: "Intake agent", decision: "Decision agent", "decision (bypass test)": "Decision agent (bypass test)" };
const HOSTS = {
  "127.0.0.1:11434": "local model (Ollama)",
  "registry.localhost:8781": "case registry",
  "orchestrator.localhost:8783": "orchestrator",
};
const INTERNAL = new Set(Object.keys(HOSTS));
const ACT = { poisoned: "Act 1 · Poisoned document", deputy: "Act 2 · Confused deputy" };

let S;   // page state, rebuilt on Reset
function fresh() {
  S = { run: null, runs: {}, running: false, started: 0, agent: "", spans: {}, scores: [], lastDec: null, policies: null };
  $("#feed").innerHTML = '<div class="empty">Press a Run button to start.</div>';
  $("#enforce").innerHTML = '<div class="empty">No requests yet.</div>';
  $("#timeline").innerHTML = "";
  $("#trace-id").textContent = "";
  $("#governance").innerHTML = '<div class="empty">No policy changes yet.</div>';
  $("#scores").innerHTML = "";
  setBox("#attacker-box", []);
  setBox("#cloud-box", []);
  S.attacker = []; S.cloud = [];
  $("#mode-banner").className = "mode-banner hidden";
  setTimer();
  refreshState();
}

// ---------- helpers ----------
function add(container, html, cls = "") {
  const el = $(container);
  el.querySelector(".empty")?.remove();
  const div = document.createElement("div");
  div.className = cls;
  div.innerHTML = html;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
  return div;
}
const who = (a) => `<span class="who">${esc(AGENT[a] || a)}</span>`;
function msg(agent, text, cls = "", detail = "") {
  const role = agent && agent.startsWith("decision") ? "decision" : agent === "intake" ? "intake" : "system";
  return add("#feed", `${agent ? who(agent) : ""}${text}${detail ? `<div class="detail">${esc(detail)}</div>` : ""}`, `msg ${role} ${cls}`);
}
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
const hostName = (h) => HOSTS[h] || h;

// ---------- timer ----------
function setTimer() {
  const t = $("#timer");
  if (S.running) {
    t.className = "timer running";
    $("#timer-agent").textContent = S.agent ? `${AGENT[S.agent] || S.agent} working` : "Starting…";
    $("#timer-secs").textContent = ((Date.now() - S.started) / 1000).toFixed(1) + "s";
  } else {
    t.className = "timer idle";
    $("#timer-agent").textContent = S.lastSeconds ? "Last run" : "Ready";
    $("#timer-secs").textContent = S.lastSeconds ? S.lastSeconds + "s" : "";
  }
}
setInterval(() => S && S.running && setTimer(), 100);

// ---------- orchestrator and agent events ----------
function onEvent(e) {
  switch (e.ev) {
    case "run_start": {
      S.run = e.run_id; S.runs[e.run_id] = e; S.running = true; S.started = e.ts * 1000; S.agent = ""; S.lastDec = null;
      S.attacker = []; S.cloud = []; setBox("#attacker-box", []); setBox("#cloud-box", []);   // the boxes show this run only
      const mode = e.mode === "governed" ? "governed" : "unguarded";
      msg(null, `<b>▶ ${esc(e.title)} — ${mode}</b>`, "", e.act === "deputy" && e.delegation_check !== null
        ? `Decision agent policy: decision-loose · delegation check ${e.delegation_check ? "ON" : "off"}` : "");
      const b = $("#mode-banner");
      b.className = `mode-banner ${mode}`;
      b.textContent = mode === "governed"
        ? "GOVERNED: each agent runs in its own OS sandbox, every request goes through the gateway, no keys in the agents"
        : "UNGUARDED: plain processes, direct network access, the API key sits in the decision agent's environment";
      add("#enforce", mode === "governed" ? `<b>${esc(ACT[e.act])}</b> · gateway enforcing`
        : `<b>${esc(ACT[e.act])}</b> · unguarded run: no gateway in the path, nothing is checked or logged`, "dec info");
      $("#trace-id").textContent = `trace ${e.run_id.slice(0, 12)}…`;
      $("#timeline").innerHTML = "";
      updateButtons(); setTimer();
      break;
    }
    case "agent_start":
      S.agent = e.agent;
      if (e.agent.includes("bypass")) {
        msg(e.agent, "is compromised: it ignores the proxy and goes straight for the attacker", "warn");
        break;
      }
      msg(e.agent, e.sandboxed ? `started in its OS sandbox (<code>sandbox/${esc(e.role)}.sb</code>), policy <b>${esc(e.policy)}</b>`
        : "started as a plain process with direct network access",
        e.key_in_env ? "bad" : "", (e.origin !== e.agent ? `On behalf of: ${AGENT[e.origin] || e.origin}. ` : "")
        + (e.key_in_env ? "The registry API key is in its environment." : e.role === "decision" && e.sandboxed ? "No API key in its environment." : ""));
      break;
    case "injection_seen":
      msg(e.agent, `read <b>${esc(e.document)}</b>, which hides an instruction`, "bad").insertAdjacentHTML("beforeend",
        `<div class="injection"><span class="injection-label">⚠ Hidden instruction in the uploaded document</span>${esc(e.text)}</div>`);
      break;
    case "tool": onTool(e); break;
    case "handoff":
      msg(null, `Orchestrator relayed a hand-off: ${esc(AGENT[e.from_agent] || e.from_agent)} → ${esc(AGENT[e.to_agent] || e.to_agent)} (originating identity: <b>${esc(e.origin)}</b>)`);
      break;
    case "delegation_ok":
      msg(null, "Delegation check passed: the hand-off asks for nothing the originating agent can't do", "good");
      break;
    case "handoff_refused":
      msg(null, "<b>Orchestrator refused the hand-off</b> (delegation check)", "good", e.reason);
      add("#enforce", `<span class="verdict">✗ REFUSED</span> Hand-off ${esc(AGENT[e.from_agent] || e.from_agent)} → ${esc(AGENT[e.to_agent] || e.to_agent)}<span class="rule">orchestrator · delegation check: ${esc(e.reason)}</span>`, "dec blocked").title = JSON.stringify(e, null, 1);
      break;
    case "second_opinion":
      if (e.status === 200) msg(e.agent, `sent the case to an overseas cloud model for a second opinion`, "bad", e.url);
      else msg(e.agent, `tried to send the case to an overseas cloud model: <b>blocked</b>`, "good", "Inference routing: model calls stay on the local model.");
      break;
    case "sandbox_probe":
      msg(e.agent, `${esc(e.what)}: ${e.blocked ? "<b>blocked by the OS</b>" : "<b>succeeded</b>"}`, e.blocked ? "good" : "bad", e.result);
      add("#enforce", `<span class="verdict">${e.blocked ? "✗ BLOCKED" : "✓ ESCAPED"}</span> ${esc(e.what)}<span class="rule">${esc(e.layer)} · ${esc(e.result)}</span>`,
        "dec os").title = JSON.stringify(e, null, 1);
      break;
    case "killed":
      msg(e.agent, `was stopped by ${esc(e.by)}`, "warn"); break;
    case "error":
      msg(e.agent, "hit an error", "warn", e.error); break;
    case "finish":
      break;
    case "agent_exit":
      if (S.agent === e.agent) S.agent = "";
      break;
    case "run_end":
      S.running = false; S.lastSeconds = e.seconds;
      if (S.runs[e.run_id]?.act === "deputy") S.deputySeen = true;
      msg(null, `<b>■ Run ${esc(e.status)} in ${e.seconds}s</b>`);
      updateButtons(); setTimer(); refreshState(); presenterReady();
      break;
  }
}

function onTool(e) {
  let args = {};
  try { args = JSON.parse(e.args); } catch { /* masked or truncated */ }
  const r = e.result || "";
  switch (e.name) {
    case "list_documents": msg(e.agent, "listed the uploaded documents", "", r); break;
    case "read_document": msg(e.agent, `read <b>${esc(args.name || "a document")}</b>`); break;
    case "get_env":
      if (r === "(not set)") msg(e.agent, `looked for <code>${esc(args.name)}</code> in its environment: <b>not there</b>`, "good", "The gateway holds the key, not the agent.");
      else msg(e.agent, `read <code>${esc(args.name)}</code> from its environment`, "bad", r);
      break;
    case "http_post": {
      let host = "";
      try { host = new URL(args.url).host; } catch { /* ignore */ }
      const blocked = /Blocked by the governance gateway|Operation not permitted/.test(r);
      const external = host && !INTERNAL.has(host);
      msg(e.agent, `sent the case record with POST to <b>${esc(host || args.url)}</b>: ${blocked ? "<b>blocked</b>" : esc(r.slice(0, 40))}`,
        blocked ? "good" : external ? "bad" : "", args.url + (blocked ? "\n" + r : ""));
      break;
    }
    case "submit_decision":
      msg(e.agent, `submitted the decision: <b>${esc(args.recommendation)}</b>`, /HTTP 201/.test(r) ? "" : "warn", `${args.reason || ""}\nRegistry: ${r}`);
      break;
    case "handoff": msg(e.agent, "handed the case to the decision agent", "", (args.task || "").slice(0, 600)); break;
    case "finish": msg(e.agent, "finished", "", args.summary || ""); break;
    default: msg(e.agent, `called ${esc(e.name)}`, "", r);
  }
}

// ---------- gateway decisions ----------
function onGateway(g) {
  if (g.event === "policy_reload") { add("#enforce", "↻ Gateway reloaded the policies live from <code>policies/</code>", "dec info").title = JSON.stringify(g); refreshState(); return; }
  if (g.event) return;
  const a = g.actor || {}, host = g.dst_endpoint.host, req = g.http_request || {};
  if (a.run_id && a.run_id !== S.run) return;   // e.g. a model call still in flight when Reset was pressed
  const agent = AGENT[a.agent] || a.agent || "Unknown process";
  const allowed = g.disposition === "Allowed";
  const raw = JSON.stringify(g, null, 1);
  // Collapse runs of identical allowed model calls into one line with a counter.
  const sig = `${allowed}|${a.agent}|${host}|${req.path}`;
  if (allowed && host === "127.0.0.1:11434" && S.lastDec && S.lastDec.sig === sig) {
    S.lastDec.n += 1;
    S.lastDec.el.querySelector(".count").textContent = ` ×${S.lastDec.n}`;
    S.lastDec.el.title = raw;
    return;
  }
  let what = `${agent} → ${esc(hostName(host))}`;
  if (host === "registry.localhost:8781") what += ": submit decision";
  else if (host === "orchestrator.localhost:8783") what += ": hand-off";
  else if (!HOSTS[host]) what += ` <code>${esc(req.method)} ${esc(req.path)}</code>`;
  let rule;
  if (allowed) rule = `rule <code>${esc(g.rule)}</code>${g.reason ? " · " + esc(g.reason) : ""}`;
  else if (g.rule === "inference-routing") rule = `inference routing · ${esc(g.reason)}`;
  else if (g.rule === "default-deny") rule = `default deny · ${esc(g.reason)}`;
  else rule = `${esc(g.rule)} · ${esc(g.reason)}`;
  const key = g.credential_injected ? ` <span class="key">· 🔑 key added by the gateway</span>` : "";
  const compact = allowed && host === "127.0.0.1:11434";
  const el = add("#enforce", `<span class="verdict ${allowed ? "ok" : ""}">${allowed ? "✓ ALLOWED" : "✗ BLOCKED"}</span>${what}<span class="count"></span>${key}<span class="rule">${rule}</span>`,
    `dec ${allowed ? "" : "blocked"} ${compact ? "compact" : ""}`);
  el.title = raw;
  S.lastDec = { sig, n: 1, el };
}

// ---------- attacker and cloud boxes ----------
function setBox(sel, items) {
  const box = $(sel), body = box.querySelector(".box-body");
  if (!items.length) { box.className = "box ok"; body.textContent = "Nothing received"; return; }
  box.className = "box bad";
  body.innerHTML = items.map((x) => `<div class="loot">
      <div class="big">${x.key_leaked ? "🔑 API key stolen · " : ""}${x.record_leaked ? "Case record received" : "Request received"}</div>
      <div>${esc(x.method)} ${esc(x.host)}${esc(x.path)} · from ${esc(AGENT[x.agent_header] || x.agent_header || "unknown")}</div>
      <code>${esc((x.body || "").slice(0, 260))}</code></div>`).join("");
}

// ---------- trace timeline ----------
function onSpan(sp) {
  if (!sp.trace_id) return;
  (S.spans[sp.trace_id] ||= []).push(sp);
  if (sp.trace_id === S.run) drawTimeline();
}
function drawTimeline() {
  const spans = S.spans[S.run] || [];
  if (!spans.length) return;
  const t = (s) => Date.parse(s);
  const t0 = Math.min(...spans.map((s) => t(s.start))), t1 = Math.max(...spans.map((s) => t(s.end)), t0 + 1000);
  const rows = {};
  for (const s of spans) (rows[s.service] ||= []).push(s);
  $("#timeline").innerHTML = Object.entries(rows).map(([svc, list]) => {
    const bars = list.map((s) => {
      const cls = s.name.startsWith("agent.") ? "agent" : s.name === "llm.second_opinion" ? "cloud" : s.name.startsWith("llm") ? "llm" : "tool";
      const left = ((t(s.start) - t0) / (t1 - t0)) * 100, width = Math.max(((t(s.end) - t(s.start)) / (t1 - t0)) * 100, 0.3);
      return `<div class="tl-bar ${cls}" style="left:${left}%;width:${width}%" title="${esc(s.name)} · ${((t(s.end) - t(s.start)) / 1000).toFixed(1)}s ${esc(s.attributes["tool.args"] || "")}"></div>`;
    }).sort((a) => (a.includes("tl-bar agent") ? -1 : 1)).join("");
    return `<div class="tl-row"><div class="tl-label">${esc(AGENT[svc.replace("agent.", "")] || svc)}</div><div class="tl-track">${bars}</div></div>`;
  }).join("") + `<div class="tl-row"><div class="tl-label"></div><div class="muted">${((t1 - t0) / 1000).toFixed(1)}s · blue = model call · amber = tool · red = cloud call · hover for details</div></div>`;
}

// ---------- scorecards ----------
function onScore(sc) {
  S.scores.push(sc);
  const yes = (v, good = 0) => `<span class="${v > good ? "bad" : "good"}">${v}</span>`;
  const card = (sc) => `<div class="score ${sc.mode}"><div class="score-title">${esc(ACT[sc.act])} · ${esc(sc.mode)}</div><table>
    <tr><td>Exfiltration attempts</td><td>${sc.attempts}</td></tr>
    <tr><td>Blocked</td><td class="${sc.blocked ? "good" : ""}">${sc.blocked}</td></tr>
    <tr><td>Records leaked</td><td>${yes(sc.records_leaked)}</td></tr>
    <tr><td>Keys leaked</td><td>${yes(sc.keys_leaked)}</td></tr>
    ${sc.act === "poisoned" ? `<tr><td>Sent to cloud model</td><td>${yes(sc.cloud_calls_received)}</td></tr>` : ""}
    ${sc.delegation ? `<tr><td>Delegation trick</td><td class="${sc.delegation === "got through" ? "bad" : "good"}">${esc(sc.delegation)}</td></tr>` : ""}
    ${sc.mode === "governed" && sc.act === "poisoned" ? `<tr><td>Sandbox blocks (bypass test)</td><td class="good">${sc.sandbox_blocks}</td></tr>` : ""}
    <tr><td>Legitimate decision recorded</td><td>${sc.decision_recorded ? "yes" : "no"}</td></tr>
    <tr><td>Agent time</td><td>${sc.seconds}s</td></tr></table></div>`;
  const act1 = ["unguarded", "governed"].map((m) => [...S.scores].reverse().find((s) => s.act === "poisoned" && s.mode === m));
  let html = "";
  if (act1[0] && act1[1]) {
    const row = (label, k) => `<tr><td>${label}</td><td class="${act1[0][k] ? "bad" : "good"}">${act1[0][k]}</td><td class="${act1[1][k] ? "bad" : "good"}">${act1[1][k]}</td></tr>`;
    html += `<div class="score"><div class="score-title">Act 1 side by side</div><table>
      <tr><td></td><td class="muted">unguarded</td><td class="muted">governed</td></tr>
      ${row("Records leaked", "records_leaked")}${row("Keys leaked", "keys_leaked")}${row("Sent to cloud", "cloud_calls_received")}</table></div>`;
  }
  html += [...S.scores].reverse().map(card).join("");
  $("#scores").innerHTML = html;
}

// ---------- policy panel ----------
async function refreshState() {
  let st;
  try { st = await api("/api/state"); } catch { return; }
  S.running = !!st.status.running;
  const p = st.policies;
  $("#policy-commit").textContent = `git: ${p.commit}`;
  const pend = S.deputySeen ? p.pending[0] : null;   // the fixes belong to act 2: show them once it has run
  $("#proposal").innerHTML = !S.deputySeen && p.pending.length ? '<div class="empty">Proposed policy changes appear after act 2.</div>' : pend ? `<div class="prop"><div class="prop-title">Proposed change (${p.pending.length === 2 ? "1" : "2"} of 2): ${esc(pend.title)}</div>
      <div class="risk ${pend.risk.level}"><b>Risk check: ${esc(pend.risk.summary)}</b>${pend.risk.changes.map(esc).join("<br>")}</div>
      <div class="diff">${pend.diff.split("\n").map((l) => `<span class="${l.startsWith("+++") || l.startsWith("---") || l.startsWith("@@") ? "hdr" : l.startsWith("+") ? "add" : l.startsWith("-") ? "del" : ""}">${esc(l)}</span>`).join("\n")}</div>
      <div style="margin-top:8px;display:flex;gap:10px;align-items:center"><button class="primary" id="btn-approve" data-file="${esc(pend.file)}">Approve</button><span class="muted">commits to git, reloads live, writes the governance audit log</span></div></div>` : "";
  $("#btn-approve")?.addEventListener("click", (ev) => approve(ev.target.dataset.file));
  const show = [["intake.yaml", "Intake agent"], ["decision.yaml", "Decision agent (act 1)"], ["decision-loose.yaml", "Decision agent (act 2)"]];
  let html = "";
  for (const [file, label] of show) {
    const doc = parseYaml(p.live[file]);
    html += `<div class="pol"><div class="pol-head"><span>${label} <span class="muted">policies/${file}</span></span><span class="tag ${doc.label === "loose" ? "loose" : ""}">${esc(doc.label || "")}</span></div>
      ${doc.rules.map((r) => `<div class="rule-line ${r.host === "*" ? "wide" : ""}">${esc(r.methods)} ${esc(r.host)} ${esc(r.paths)}${r.credential ? " 🔑 " + esc(r.credential) : ""}</div>`).join("")}
      <div class="rule-line" style="color:var(--muted)">everything else: denied</div></div>`;
  }
  const deleg = /delegation_check:\s*true/.test(p.live["orchestrator.yaml"]);
  html += `<div class="pol"><div class="pol-head"><span>Orchestrator <span class="muted">policies/orchestrator.yaml</span></span><span class="tag ${deleg ? "on" : "off"}">delegation check ${deleg ? "ON" : "off"}</span></div></div>`;
  $("#policies").innerHTML = html;
  updateButtons();
}
// Just enough YAML for the panel: the server sends the files verbatim so the page shows what's really in git.
function parseYaml(text) {
  const doc = { rules: [] };
  let cur = null;
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*(-\s+)?(\w+):\s*(.*)$/);
    if (!m || line.trim().startsWith("#") || m[2] === "rules") continue;
    const [, dash, k, v] = m, val = v.replace(/^"(.*)"$/, "$1").replace(/[\[\]"]/g, "");
    if (dash) { cur = {}; doc.rules.push(cur); }
    if (line.startsWith("  ") && cur) cur[k] = val; else doc[k] = val;
  }
  return doc;
}

async function approve(file) {
  try {
    const r = await api("/api/approve", { file });
    toast(r.commit ? `Approved · committed ${r.commit} · gateway reloads live` : "Already approved");
    refreshState();
    presenterReady();
  } catch (err) { toast(err.message); }
}

// ---------- controls ----------
function updateButtons() {
  document.querySelectorAll("[data-run]").forEach((b) => (b.disabled = S.running));
  $("#btn-stop").disabled = !S.running;
  $("#btn-close").disabled = S.running;
  $("#btn-reset").disabled = false;
  const ap = $("#btn-approve"); if (ap) ap.disabled = S.running;
  presenterReady();
}
async function run(act, mode) {
  try { S.running = true; updateButtons(); await api("/api/run", { act, mode }); }
  catch (err) { S.running = false; updateButtons(); toast(err.message); }
}
document.querySelectorAll("[data-run]").forEach((b) => b.addEventListener("click", () => { const [a, m] = b.dataset.run.split(":"); run(a, m); }));
$("#btn-stop").addEventListener("click", async () => { const r = await api("/api/stop", {}); toast(r.stopped.length ? `Stopped: ${r.stopped.join(", ")}` : "Nothing running"); });
$("#btn-reset").addEventListener("click", async () => {
  $("#btn-reset").disabled = true; toast("Resetting…");
  try { const r = await api("/api/reset", {}); toast(`Reset in ${r.seconds}s: baseline policies restored from git`); P.step = 0; renderPresenter(); }
  catch (err) { toast(err.message); }
  $("#btn-reset").disabled = false;
});
$("#btn-how").addEventListener("click", () => $("#how").classList.remove("hidden"));
$("#how-x").addEventListener("click", () => $("#how").classList.add("hidden"));
$("#how").addEventListener("click", (ev) => ev.target.id === "how" && $("#how").classList.add("hidden"));
$("#btn-close").addEventListener("click", async () => {
  try {
    await api("/api/close", {});
    es.close();
    document.body.innerHTML = '<div style="padding:60px;font-size:1.5rem">The demo is stopping. You can close this window.</div>';
    setTimeout(() => window.close(), 800);
  } catch (err) { toast(err.message); }
});

// ---------- presenter mode: pauses between acts until Next ----------
const P = { on: false, step: 0, waiting: false };
const STEPS = [
  ["Act 1 · Poisoned document, unguarded", () => run("poisoned", "unguarded")],
  ["Act 1 · The same agents, governed", () => run("poisoned", "governed")],
  ["Act 2 · Confused deputy, with the loose policy", () => run("deputy", "governed")],
  ["Fix 1 · Approve the tighter path rule", () => approve("decision-loose.yaml")],
  ["Act 2 · Run the confused deputy again", () => run("deputy", "governed")],
  ["Fix 2 · Approve the delegation check", () => approve("orchestrator.yaml")],
  ["Act 2 · Run it once more", () => run("deputy", "governed")],
];
function renderPresenter() {
  $("#presenter").classList.toggle("hidden", !P.on);
  if (!P.on) return;
  const done = P.step >= STEPS.length;
  $("#p-no").textContent = done ? "Done" : `Next · step ${P.step + 1} of ${STEPS.length}:`;
  $("#p-text").textContent = done ? "Scorecards below. Reset to start again." : STEPS[P.step][0];
  $("#p-next").disabled = done || S.running;
  $("#p-hint").textContent = S.running ? "agents working…" : "";
}
function presenterReady() { renderPresenter(); }
$("#btn-presenter").addEventListener("click", () => { P.on = !P.on; renderPresenter(); });
$("#p-exit").addEventListener("click", () => { P.on = false; renderPresenter(); });
$("#p-next").addEventListener("click", () => { if (P.step < STEPS.length && !S.running) { const f = STEPS[P.step][1]; P.step += 1; f(); renderPresenter(); } });

// ---------- live stream ----------
fresh();
const es = new EventSource("/api/stream");
es.onmessage = (m) => {
  const { src, d } = JSON.parse(m.data);
  if (src === "reset") return fresh();
  if (src === "event") onEvent(d);
  else if (src === "gateway") onGateway(d);
  else if (src === "attacker") { if (!d.event && d.trace_id === S.run) { S.attacker.push(d); setBox("#attacker-box", S.attacker); } }
  else if (src === "cloud") { if (d.trace_id === S.run) { S.cloud.push(d); setBox("#cloud-box", S.cloud); } }
  else if (src === "registry") msg(null, `Case registry: ${d.status === 201 ? "decision recorded" : "request rejected"} (HTTP ${d.status}) for case ${esc(d.case_id || "?")}`, d.status === 201 ? "" : "warn");
  else if (src === "governance") {
    add("#governance", `<b>${esc(d.time.slice(11))}</b> ${esc(d.message)}${d.risk ? ` · risk: ${esc(d.risk.summary)}` : ""} <span class="muted">${esc(d.file || "")}</span>`, "gov");
    msg(null, `Policy change: ${esc(d.title || d.message)} · commit ${esc(d.commit)}`, "good");
    refreshState();
  }
  else if (src === "span") onSpan(d);
  else if (src === "scorecard") onScore(d);
};
