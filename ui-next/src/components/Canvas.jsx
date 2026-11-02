import { useEffect, useMemo } from "react";
import { Background, BackgroundVariant, Handle, MarkerType, Position, ReactFlow, useReactFlow } from "@xyflow/react";
import { AlertTriangle, Cpu, Database, FileSearch, FileText, Gavel, GitBranch, Globe, KeyRound, Lock, Route, ScrollText, ShieldCheck, Skull, User, UserCheck, Users, Workflow } from "lucide-react";
import FlowEdge from "./FlowEdge.jsx";

// ---------- the grid ----------
// Columns: applicant over documents · agents · (gateway) · destinations, with the same 70px gap between zones.
// The rows are spread so the diagram's shape matches the canvas and fills it.
// Every card is sized to its content. Each destination has its own lane: a separate exit on the decision agent,
// a lane through the gateway at the destination's exact height, and a straight run to the card.
const COL = { docs: 0, agents: 270, gw: 690 };
const DEST_X = { open: 690, governed: 1040 };
const W = { applicant: 170, docs: 200, agent: 320, svc: 280, gw: 250 };
const HT = { agent: 106, svc: 92, docs: 104 };
const ZONE_H = 760;
const ROW = { intake: 80, orch: (ZONE_H - HT.svc) / 2, decision: ZONE_H - 80 - HT.agent };
const MID = ROW.orch + HT.svc / 2;
const DEST_Y = { model: 76, registry: 222, attacker: 476, cloud: 622 };
const ZONES = { trusted: [0, 360], external: [400, 360] };
const LANE = Object.fromEntries(Object.entries(DEST_Y).map(([k, y]) => [k, y + HT.svc / 2]));
const EXIT = { model: "20%", registry: "40%", attacker: "62%", cloud: "84%" };   // the decision agent's exits, one per lane
const CONTROL_Y = -180;

const COLOR = { idle: "var(--edge-idle)", active: "var(--blue)", used: "var(--blue)", ok: "var(--allow)", key: "var(--allow)", leak: "var(--block)" };

const H = ({ id, pos, type = "source", style }) => <Handle id={id} type={type} position={pos} style={style} isConnectable={false} />;
const SIDES = (
  <>
    <H id="r" pos={Position.Right} /><H id="rt" pos={Position.Right} type="target" /><H id="l" pos={Position.Left} type="target" />
    <H id="t" pos={Position.Top} type="target" /><H id="b" pos={Position.Bottom} />
  </>
);
const Num = ({ n }) => (n ? <span className="lnum" title={`Layer ${n}`}>{n}</span> : null);
const cls = (d, extra = "") => `card ${d.hot ? "hot" : ""} ${d.recede ? "recede" : ""} ${extra}`;

function Zone({ data }) {
  const Icon = data.icon;
  return <div className={`zone ${data.variant || ""} ${data.recede ? "recede" : ""}`}><div className="zone-label">{Icon && <Icon size={13} strokeWidth={2.4} />}{data.label}</div></div>;
}

function Agent({ data }) {
  const Icon = data.high ? Gavel : FileSearch;
  return (
    <div className={cls(data, data.dim ? "dim" : "")}>
      {data.sandbox && (
        <div className={`sandbox-ring ${data.hits ? "hit" : ""}`}>
          <span><Lock size={10} strokeWidth={3} /> {data.badges ? "1 · " : ""}OS SANDBOX</span>
          {data.hits > 0 && <span className="hits"><Lock size={10} strokeWidth={3} /> {data.hits} BYPASS ATTEMPTS BLOCKED BY THE OS</span>}
        </div>
      )}
      <div className="row">
        <div className={`ico ${data.high ? "agent-hi" : "agent"}`}><Icon size={21} /></div>
        <div><h3>{data.title}</h3><div className="sub">{data.sub}</div></div>
        {data.hot && <span className="working" />}
      </div>
      <div className="meta">
        <span className={`tag ${data.high ? "warn" : "blue"}`}>{data.high ? "High privilege" : "Low privilege"}</span>
        {data.keyInEnv && <span className="tag bad"><KeyRound size={11} strokeWidth={2.6} /> KEY IN ITS ENVIRONMENT</span>}
        {data.noKey && <span className="tag good"><KeyRound size={11} strokeWidth={2.6} /> NO KEY HELD</span>}
        {data.token && !data.keyInEnv && !data.noKey && !data.dim && <span className="tag">gateway token</span>}
        {data.dim && <span className="tag bad">NEVER STARTED</span>}
      </div>
      {SIDES}
      {Object.entries(EXIT).map(([k, top]) => <H key={k} id={`x-${k}`} pos={Position.Right} style={{ top }} />)}
    </div>
  );
}

function Service({ data }) {
  const Icon = data.icon;
  const st = data.status;
  return (
    <div className={cls(data, `${st === "safe" ? "safe" : ""} ${st === "hit" ? "hit" : ""}`)}>
      <div className="row">
        <div className={`ico ${data.tone}`}><Icon size={20} /></div>
        <div><h3>{data.title} <Num n={data.num} /></h3><div className="sub">{data.sub}</div></div>
      </div>
      <div className="meta">
        {st === "hit" && <span className="tag bad">RECEIVED: {data.got}</span>}
        {st === "safe" && <span className="tag good">NOTHING RECEIVED</span>}
        {st === "recorded" && <span className="tag good">DECISION RECORDED</span>}
        {!st && data.tone === "ext" && <span className="tag bad">MUST NEVER RECEIVE DATA</span>}
        {!st && data.tone !== "ext" && data.idle && <span className={`tag ${data.idleTone || ""}`}>{data.idle}</span>}
      </div>
      {SIDES}
      <H id="b2" pos={Position.Bottom} style={{ left: "16%" }} />
      <H id="l2" pos={Position.Left} style={{ top: "82%" }} />
    </div>
  );
}

function Docs({ data }) {
  return (
    <div className={cls(data, data.flag ? "poisoned" : "")}>
      <div className="row"><div className="ico doc"><FileText size={20} /></div><div><h3>Documents</h3><div className="sub">form · report · letter</div></div></div>
      <div className="meta">
        {data.flag ? <span className="tag warn"><AlertTriangle size={11} strokeWidth={2.6} /> {data.flag}</span> : <span className="tag">3 uploaded files</span>}
      </div>
      {SIDES}
      <H id="r-up" pos={Position.Right} style={{ top: "30%" }} /><H id="r-down" pos={Position.Right} style={{ top: "70%" }} />
    </div>
  );
}

function Person({ data }) {
  return (
    <div className={cls(data, "person")}>
      <div className="row"><div className="ico person"><User size={20} /></div><div><h3>Applicant</h3><div className="sub">uploads the case</div></div></div>
      {SIDES}
    </div>
  );
}

const CAPS = [
  { id: "policy", n: 2, icon: ShieldCheck, name: "Default-deny policy", sub: "agent · host · method · path" },
  { id: "broker", n: 3, icon: KeyRound, name: "Credential broker", sub: "holds the registry key" },
  { id: "routing", n: 4, icon: Route, name: "Inference routing", sub: "model calls stay local" },
  { id: "audit", n: 7, icon: ScrollText, name: "Audit log", sub: "one line per decision" },
];

function Gateway({ data }) {
  return (
    <div className={`gateway ${data.hot ? "hot" : ""} ${data.recede ? "recede" : ""}`}>
      <div className="g-head">
        <div className="ico"><ShieldCheck size={21} /></div>
        <div><h3>Governance gateway</h3><div className="g-sub">every request · default deny</div></div>
      </div>
      {CAPS.map((c) => {
        const n = data.gw[c.id] || 0;
        const Icon = c.icon;
        const sub = c.id === "policy" && data.rule ? data.rule : c.sub;
        return (
          <div key={c.id} className={`cap ${n ? "on" : ""} ${c.id === "policy" && data.loose ? "loose" : ""}`}>
            <div className="ci"><Icon size={15} /></div>
            <div><b>{c.name} {data.badges && <Num n={c.n} />}</b><small>{sub}</small></div>
            <span className="cnt">{n ? `×${n}` : ""}</span>
          </div>
        );
      })}
      {Object.entries(LANE).map(([k, top]) => (
        <span key={k}>
          <H id={`in-${k}`} pos={Position.Left} type="target" style={{ top }} />
          <H id={`out-${k}`} pos={Position.Right} style={{ top }} />
        </span>
      ))}
      <H id="t" pos={Position.Top} type="target" />
    </div>
  );
}

const nodeTypes = { zone: Zone, agent: Agent, service: Service, docs: Docs, gateway: Gateway, person: Person };
const edgeTypes = { flow: FlowEdge };

// Which components exist in each chapter.
function topology(id) {
  const governed = ["with", "deputy", "learned"].includes(id);
  return { governed, cloud: id !== "deputy", control: ["deputy", "learned"].includes(id), badges: id === "learned" };
}

// Keep the whole architecture in view: on resize, and with a short glide when the chapter changes.
function AutoFit({ chapter }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    const el = document.querySelector(".canvas");
    const ro = new ResizeObserver(() => fitView({ padding: 0.06 }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitView]);
  useEffect(() => {
    const h = setTimeout(() => fitView({ padding: 0.06, duration: 600 }), 80);
    return () => clearTimeout(h);
  }, [chapter, fitView]);
  return null;
}

export default function Canvas({ chapter, st }) {
  const T = topology(chapter);
  const dx = T.governed ? DEST_X.governed : DEST_X.open;
  const deputy = chapter === "deputy";
  const hotList = Array.isArray(st.hot) ? st.hot : st.hot ? [st.hot] : [];
  const focus = chapter === "meet" && hotList.length > 0;   // on the tour, everything but the current step steps back
  const isHot = (id) => hotList.includes(id);
  const recede = (id) => focus && !isHot(id);

  const nodes = useMemo(() => {
    const n = [];
    const z = (id, x, y, w, h, data) => n.push({ id, type: "zone", position: { x, y }, data: { recede: focus, ...data }, style: { width: w, height: h }, zIndex: -1, selectable: false });
    z("z-runtime", COL.agents - 30, 0, W.agent + 60, ZONE_H, { label: "Agent runtime", icon: Workflow });
    z("z-trusted", dx - 30, ZONES.trusted[0], W.svc + 60, ZONES.trusted[1], { label: "Inside the trust boundary", icon: Lock, variant: "trusted" });
    z("z-external", dx - 30, ZONES.external[0], W.svc + 60, T.cloud ? ZONES.external[1] : 214, { label: "Outside · untrusted", icon: Globe, variant: "external" });
    if (T.control) z("z-control", COL.agents - 30, CONTROL_Y - 44, COL.gw + W.gw - COL.agents + 60, 160, { label: "Control plane · policy as code", icon: GitBranch, variant: "control" });

    const card = (id, type, x, y, w, h, data) => n.push({ id, type, position: { x, y }, style: { width: w, height: h }, data: { hot: isHot(id), recede: recede(id), ...data } });
    card("applicant", "person", COL.docs + (W.docs - W.applicant) / 2, MID - HT.docs / 2 - 170, W.applicant, 76, {});
    card("docs", "docs", COL.docs, MID - HT.docs / 2, W.docs, HT.docs,
      { flag: st.docs === "poisoned" ? "HIDDEN TEXT" : st.docs === "referral" ? "REFERRAL REQUEST" : null });
    card("intake", "agent", COL.agents, ROW.intake, W.agent, HT.agent,
      { title: "Intake agent", sub: "Reads documents, hands the case on", sandbox: T.governed, token: T.governed, badges: T.badges });
    card("orch", "service", COL.agents + 20, ROW.orch, W.agent - 40, HT.svc,
      { title: "Orchestrator", sub: "Relays handoffs between agents", icon: deputy || T.badges ? Users : Workflow, tone: "svc", num: T.badges ? 6 : null,
        idle: deputy || T.badges ? (st.delegationOn || T.badges ? "DELEGATION CHECK ON" : "DELEGATION CHECK OFF") : "identity on every hand-off",
        idleTone: deputy || T.badges ? (st.delegationOn || T.badges ? "good" : "warn") : "" });
    card("decision", "agent", COL.agents, ROW.decision, W.agent, HT.agent,
      { title: "Decision agent", sub: "Decides and records the decision", high: true, sandbox: T.governed, token: T.governed, badges: T.badges,
        keyInEnv: st.keyInEnv, noKey: st.keyMissing, hits: st.sandboxHits, dim: st.decisionIdle });
    if (T.governed) {
      n.push({ id: "gw", type: "gateway", position: { x: COL.gw, y: 0 }, style: { width: W.gw, height: ZONE_H },
        data: { gw: st.gw, badges: T.badges, loose: st.looseRule, hot: isHot("gw"), recede: recede("gw"),
                rule: st.looseRule ? "decision: POST anywhere (loose)" : st.ruleTight ? "decision: registry path only" : null } });
    }
    const svc = (id, y, d) => card(id, "service", dx, y, W.svc, HT.svc, d);
    svc("model", DEST_Y.model, { title: "Local AI model", sub: "Qwen 3 on this laptop", icon: Cpu, tone: "svc", idle: "local only" });
    svc("registry", DEST_Y.registry, { title: "Case registry", sub: "Needs an API key", icon: Database, tone: "svc", idle: "decisions only",
      status: st.registry === "recorded" ? "recorded" : null });
    svc("attacker", DEST_Y.attacker, { title: deputy ? "Partner referral URL" : "Attacker", sub: deputy ? "really the attacker’s listener" : "looks like an audit service",
      icon: Skull, tone: "ext", status: st.attacker ? "hit" : st.finished ? "safe" : null, got: st.attacker });
    if (T.cloud) svc("cloud", DEST_Y.cloud, { title: "Overseas AI model", sub: "Outside the country", icon: Globe, tone: "ext",
      status: st.cloud ? "hit" : st.finished ? "safe" : null, got: "HEALTH DATA" });
    if (T.control) {
      card("approver", "service", COL.agents + 10, CONTROL_Y, W.agent - 20, HT.svc,
        { title: "Human approver", sub: "Reviews the diff and risk check", icon: UserCheck, tone: "svc", idle: "approves policy changes" });
      card("repo", "service", COL.gw, CONTROL_Y, W.gw, HT.svc,
        { title: "Policy repository", sub: "YAML in git, reviewed", icon: GitBranch, tone: "svc", num: T.badges ? 5 : null,
          idle: st.delegationOn ? "2 changes approved" : st.ruleTight ? "1 change approved" : "baseline", idleTone: st.ruleTight || st.delegationOn ? "good" : "" });
    }
    return n;
  }, [chapter, st]);

  const edges = useMemo(() => {
    const list = [
      ["applicant-docs", "applicant", "b", "docs", "t", { shape: "straight", label: "uploads" }],
      ["docs-intake", "docs", "r-up", "intake", "l", { shape: "step", label: "reads" }],
      ["docs-decision", "docs", "r-down", "decision", "l", { shape: "step", label: "reads" }],
      ["intake-orch", "intake", "b", "orch", "t", { shape: "straight", label: "hand-off" }],
      ["orch-decision", "orch", "b", "decision", "t", { shape: "straight" }],
    ];
    if (T.governed) {
      list.push(["intake-gw-model", "intake", "r", "gw", "in-model", { label: "model calls" }], ["decision-gw-model", "decision", "x-model", "gw", "in-model"],
        ["gw-model", "gw", "out-model", "model", "l", { shape: "straight" }],
        ["decision-gw-registry", "decision", "x-registry", "gw", "in-registry"],
        ["gw-registry", "gw", "out-registry", "registry", "l", { shape: "straight", label: "submits decision" }],
        ["decision-gw-attacker", "decision", "x-attacker", "gw", "in-attacker", { stopLabel: "DEFAULT DENY" }],
        ["gw-attacker", "gw", "out-attacker", "attacker", "l", { shape: "straight" }]);
      if (T.cloud) list.push(["decision-gw-cloud", "decision", "x-cloud", "gw", "in-cloud", { stopLabel: "INFERENCE ROUTING" }],
        ["gw-cloud", "gw", "out-cloud", "cloud", "l", { shape: "straight" }]);
    } else {
      list.push(["intake-model", "intake", "r", "model", "l", { label: "model calls" }], ["decision-model", "decision", "x-model", "model", "l"],
        ["decision-registry", "decision", "x-registry", "registry", "l", { label: "submits decision" }],
        ["decision-attacker", "decision", "x-attacker", "attacker", "l"], ["decision-cloud", "decision", "x-cloud", "cloud", "l"]);
    }
    if (T.control) list.push(["approver-repo", "approver", "r", "repo", "l", { shape: "straight", label: "approves" }],
      ["repo-gw", "repo", "b", "gw", "t", { shape: "straight", label: "live reload" }],
      ["repo-orch", "repo", "l2", "orch", "rt", { shape: "step", label: "delegation rule" }]);   // down the gap beside the gateway
    return list.map(([id, source, sourceHandle, target, targetHandle, extra = {}]) => {
      let state = st.edges[id] || "idle";
      let more = {};
      if (state === "refused") { state = "blocked"; more = { stopAt: 0.5, stopLabel: "DELEGATION CHECK" }; }
      if (!T.governed && state === "ok") state = "used";   // nothing "allows" anything when there is no governance
      const faded = focus && !(isHot(source) || isHot(target));
      return {
        id, source, sourceHandle, target, targetHandle, type: "flow", zIndex: state !== "idle" ? 2 : 0,
        markerEnd: state === "blocked" ? undefined : { type: MarkerType.ArrowClosed, width: 14, height: 14, color: COLOR[state] || COLOR.idle },
        data: { shape: "bezier", ...extra, ...more, state, faded },
      };
    });
  }, [chapter, st]);

  return (
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} fitView fitViewOptions={{ padding: 0.06 }}
      nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} zoomOnScroll={false} panOnDrag={false}
      zoomOnDoubleClick={false} preventScrolling={false} minZoom={0.3}>
      <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color="var(--dots)" />
      <AutoFit chapter={chapter} />
    </ReactFlow>
  );
}
