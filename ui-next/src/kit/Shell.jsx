// The shared demo shell: top bar with chapters, the architecture canvas, a controls row, and the right rail
// (what just happened · timeline · what to notice · outcome). Everything demo-specific comes from `demo`:
//   { id, name, subtitle, chapters, controls, controlNoun, short, sheetRows, Canvas, Summary, stateAt, logLabel, legend, live? }
// Chapter flags: intro (tour, no legend or controls) · controlsOff (controls shown as off) · summary (rail shows Summary).
//
// Live mode: when `demo.live` is set and the demo's server answers, steps come from the real runs (demo.live.steps),
// Run / Stop / Reset / Close call the demo's API, the timer shows real time, and the rail can show a pending
// policy change with its diff and risk check. Without a server, the scripted steps play as a mock.
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Ban, Check, CheckCircle2, ChevronRight, GitPullRequestArrow, Info, Moon, Play, Power, RotateCcw, ShieldCheck, Square, StepForward, Sun, UserCheck, X, XCircle } from "lucide-react";
import { useLive } from "../live/useLive.js";

const VERDICT = {
  info: { label: "STEP", icon: Info }, warn: { label: "WATCH", icon: AlertTriangle }, allowed: { label: "ALLOWED", icon: Check },
  blocked: { label: "BLOCKED", icon: Ban }, leak: { label: "LEAKED", icon: XCircle }, policy: { label: "POLICY CHANGE", icon: GitPullRequestArrow },
  gate: { label: "HUMAN APPROVAL", icon: UserCheck }, done: { label: "COMPLETE", icon: CheckCircle2 },
};
const STEP_MS = 2600;

export default function Shell({ demo, demos, onSwitch }) {
  const { controls } = demo;
  const CTRL = useMemo(() => Object.fromEntries(controls.map((x) => [x.id, x])), [controls]);
  const live = useLive(demo.live);
  const [c, setC] = useState(0);
  const base = demo.chapters[c];
  const liveSteps = live ? demo.live.steps(base.id, live.model) : undefined;   // undefined: this chapter isn't live
  const isLive = liveSteps !== undefined;
  const ch = isLive ? { ...base, steps: liveSteps || [] } : base;
  const last = ch.steps.length - 1;
  const [pick, setPick] = useState(null);   // a step the presenter clicked; null follows the newest
  const [playing, setPlaying] = useState(false);
  const [theme, setTheme] = useState("light");
  const [sheet, setSheet] = useState(null);
  const [toast, setToast] = useState(null);
  const [now, setNow] = useState(Date.now());
  const i = pick === null ? last : Math.min(pick, last);
  const st = useMemo(() => demo.stateAt(ch, i), [demo, ch, i]);
  const current = live?.model.current();
  const running = !!current || !!live?.state.status.running;
  const Canvas = demo.Canvas, Summary = demo.Summary;

  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => { setPlaying(false); setC(0); setPick(null); setSheet(null); }, [demo]);
  useEffect(() => {   // keep the current step in view (the newest one while following)
    const box = document.querySelector(".timeline"), cur = box?.querySelector(".tl.cur");   // scroll the list only, never the page
    if (!cur) return;
    const b = box.getBoundingClientRect(), r = cur.getBoundingClientRect();
    if (r.top < b.top) box.scrollTop += r.top - b.top - 8;
    else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom + 8;
  }, [i, c, ch.steps.length]);
  useEffect(() => {   // scripted replay (mock mode)
    if (!playing) return;
    if (i >= last) { setPlaying(false); setPick(null); return; }
    const h = setTimeout(() => setPick((x) => (x ?? -1) + 1), STEP_MS);
    return () => clearTimeout(h);
  }, [playing, i, last]);
  useEffect(() => {
    if (!running) return;
    const h = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(h);
  }, [running]);

  const say = (text) => { setToast(text); setTimeout(() => setToast(null), 3500); };
  const act = async (fn, okText) => { try { const r = await fn(); if (okText) say(typeof okText === "function" ? okText(r) : okText); } catch (e) { say(e.message); } };
  const go = (k) => { setPlaying(false); setC(k); setPick(null); };
  const step = i >= 0 ? ch.steps[i] : null;
  const name = (id) => CTRL[id]?.name || id;
  const action = isLive ? demo.live.action(base.id, live) : null;
  const approval = isLive ? demo.live.approval?.(base.id, live) : null;
  const outcome = isLive ? (!running ? demo.live.outcome(base.id, live) : null) : ch.outcome;

  let timer = null;
  if (isLive) {
    if (current) timer = { v: Math.max(0, now / 1000 - current.start), sub: demo.live.agentName?.(current.agentNow) || "starting…" };
    else if (step) timer = { v: step.t, sub: step.stage || "agent time" };
  } else if (!ch.intro && ch.run) timer = { v: step ? step.t : 0, sub: step?.stage || "agent time" };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <ShieldCheck size={24} aria-hidden="true" />
          <span className="sep" />
          <div><h1>{demo.name}</h1><p>{demo.subtitle}</p></div>
        </div>
        <nav className="stepper">
          {demo.chapters.map((x, k) => (
            <span key={x.id} style={{ display: "contents" }}>
              {k > 0 && <span className="bar" />}
              <button className={`ch ${k === c ? "on" : ""} ${k < c ? "done" : ""}`} onClick={() => go(k)} title={x.title}>
                <span className="n">{k < c ? <Check size={13} strokeWidth={3} /> : k + 1}</span><span className="lbl">{x.title}</span>
              </button>
            </span>
          ))}
        </nav>
        <div className="actions">
          {demos && !live && (
            <div className="switch" title="Design mock: switch demo">
              {demos.map((d) => <button key={d.id} className={d.id === demo.id ? "on" : ""} onClick={() => onSwitch(d.id)}>{d.tab}</button>)}
            </div>
          )}
          <span className={`pill ${ch.pill[0]}`}><span className="dot" />{ch.pill[1]}</span>
          {timer && <div className={`timer ${current ? "live" : ""}`}>{timer.v.toFixed(1)}s<small>{timer.sub}</small></div>}
          {isLive ? <>
            {running
              ? <button className="btn danger" onClick={() => act(live.stop, (r) => (r.stopped?.length ? `Stopped: ${r.stopped.join(", ")}` : "Nothing running"))}><Square size={14} fill="currentColor" /> Stop agent</button>
              : action && <button className="btn primary" disabled={action.disabled} title={action.hint || ""} onClick={() => { setPick(null); act(action.onClick); }}>
                  <Play size={15} fill="currentColor" /> {action.label}</button>}
          </> : ch.run && <>
            <button className="btn primary" onClick={() => { setPick(0); setPlaying(true); }}><Play size={15} fill="currentColor" /> {ch.run}</button>
          </>}
          {ch.steps.length > 0 && !ch.summary && (
            <button className="btn" onClick={() => { setPlaying(false); setPick(Math.min(last, i + 1)); }}><StepForward size={15} /> Step</button>
          )}
          {live ? <>
            <button className="btn icon" title="Reset: baseline policies from git, clear the screen, stop any agent" onClick={() => act(live.reset, (r) => `Reset in ${r.seconds}s`)}><RotateCcw size={15} /></button>
            <button className="btn icon" title="Close the demo" disabled={running} onClick={() => act(async () => { await live.close(); document.body.innerHTML = '<div style="padding:60px;font:500 24px/1.4 sans-serif">The demo is stopping. You can close this window.</div>'; setTimeout(() => window.close(), 800); })}><Power size={15} /></button>
          </> : ch.run && (
            <button className="btn icon" title="Reset" onClick={() => { setPlaying(false); setPick(-1); }}><RotateCcw size={15} /></button>
          )}
          <button className="btn icon" title="Light or dark" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
            {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </div>
      </header>

      <div className="main">
        <section className="stage">
          <div className="stage-head"><h2>{ch.title}</h2><p>{ch.lead}</p></div>
          <div className="canvas">
            <Canvas chapter={ch.id} st={st} />
            {!ch.intro && <div className="legend">
              {(demo.legend || [["var(--blue)", "in progress"], ["var(--allow)", "allowed"], ["var(--block)", "leaked or stopped"]]).map(([col, label]) => (
                <span key={label}><i style={{ background: col }} />{label}</span>
              ))}
            </div>}
          </div>
          {!ch.intro && <div className="layers">
            {controls.map((l) => {
              const n = ch.summary ? 0 : st.acted[l.id] || 0;
              const Icon = l.icon;
              const off = ch.controlsOff;
              return (
                <button key={l.id} className={`layer ${n ? "acted" : ""} ${off ? "off" : ""}`} onClick={() => setSheet(l.id)}
                  title={`${l.name}: ${l.short}${off ? " (off in this run)" : ""}`}>
                  <span className="li"><Icon size={14} strokeWidth={2.4} /></span>
                  <b>{l.n} · {demo.short?.[l.id] || l.name}</b>
                  {n > 0 && <span className="cnt">×{n}</span>}
                </button>
              );
            })}
          </div>}
        </section>

        <aside className="rail">
          {ch.summary ? <Summary onControl={setSheet} live={live} /> : <>
            {approval && <Approval p={approval} disabled={running} onApprove={() => act(() => live.approve(approval.file), (r) => (r.commit ? `Approved · committed ${r.commit} · applied live` : "Already approved"))} />}
            <div className="rail-sec">
              <div className="rail-title"><span>{ch.intro ? "Who’s who" : "What just happened"}</span><span>{ch.steps.length ? `${i + 1} / ${ch.steps.length}` : ""}</span></div>
              <AnimatePresence mode="wait">
                <motion.div key={`${demo.id}-${c}-${i}-${step?.title}`} className="now" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.25 }}>
                  {step ? <>
                    <Verdict v={step.verdict} />
                    {step.stage && <span className="stage-tag" style={{ marginLeft: 10 }}>{step.stage}</span>}
                    <h3>{step.title}</h3>
                    <p>{step.detail}</p>
                    {step.hidden && <pre className="hidden-text">{step.hidden}</pre>}
                    {step.layers?.length > 0 && (
                      <div className="chips">
                        {step.layers.map((l) => (
                          <button key={l} className="lchip" onClick={() => setSheet(l)}><ShieldCheck size={14} /> {name(l)} <ChevronRight size={14} /></button>
                        ))}
                      </div>
                    )}
                    {step.rule && <div className="rule">{demo.ruleLabel || "rule"}: {step.rule}</div>}
                    {step.raw && <details className="raw"><summary>Gateway log line</summary><pre>{step.raw}</pre></details>}
                  </> : <>
                    <Verdict v="info" /><h3>{isLive ? (action ? "Ready" : "Waiting") : "Ready"}</h3>
                    <p>{isLive ? (action ? `Press ${action.label} to run it live.` : "") : `Press ${ch.run} to watch it step by step.`}</p>
                  </>}
                </motion.div>
              </AnimatePresence>
            </div>
            <div className="rail-title" style={{ padding: "0 22px" }}><span>Timeline</span><span>{ch.intro ? "tour" : demo.logLabel}</span></div>
            <div className="timeline">
              {ch.steps.map((s, k) => {
                const V = VERDICT[s.verdict];
                return (
                  <button key={k} className={`tl ${k === i ? "cur" : ""} ${k > i ? "future" : ""}`} onClick={() => { setPlaying(false); setPick(k === last ? null : k); }}>
                    <span className={`d ${s.verdict}`}><V.icon size={14} strokeWidth={2.6} /></span>
                    <span><b>{s.title}</b><small>{[s.stage, ...(s.layers || []).map(name)].filter(Boolean).join(" · ")}</small></span>
                    <span className="t">{ch.intro ? "" : `${s.t.toFixed(1)}s`}</span>
                  </button>
                );
              })}
            </div>
            {ch.notice && !(outcome && i === last) && !approval && (
              <div className="notice"><h5>What to notice</h5><ul>{ch.notice.map((x) => <li key={x}>{x}</li>)}</ul></div>
            )}
            <AnimatePresence>
              {outcome && i === last && (
                <motion.div className={`outcome ${outcome.tone}`} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  <h4>{outcome.tone === "good" ? <CheckCircle2 size={18} /> : <XCircle size={18} />} {outcome.title}</h4>
                  <div className="stats">{outcome.stats.map(([v, l]) => <Stat key={l} v={v} l={l} />)}</div>
                </motion.div>
              )}
            </AnimatePresence>
          </>}
        </aside>
      </div>

      <AnimatePresence>{sheet && <ControlSheet item={CTRL[sheet]} rows={demo.sheetRows(CTRL[sheet])} noun={demo.controlNoun}
        total={controls.length} acted={st.acted[sheet] || 0} onClose={() => setSheet(null)} />}</AnimatePresence>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function Approval({ p, disabled, onApprove }) {
  return (
    <div className="approval">
      <div className="approval-head"><GitPullRequestArrow size={16} /> {p.title}</div>
      <p>{p.why}</p>
      <div className={`risk ${p.risk.level}`}><b>Risk check: {p.risk.summary}</b>{p.risk.changes.join(" · ")}</div>
      <pre className="diff">{p.diff.split("\n").map((l, k) => (
        <span key={k} className={/^(\+\+\+|---|@@)/.test(l) ? "hdr" : l.startsWith("+") ? "add" : l.startsWith("-") ? "del" : ""}>{l + "\n"}</span>
      ))}</pre>
      <div className="approval-actions">
        <button className="btn primary" disabled={disabled} onClick={onApprove}><Check size={15} /> Approve</button>
        <span>commits to git · applied live · logged in the governance audit</span>
      </div>
    </div>
  );
}

function Verdict({ v }) {
  const V = VERDICT[v] || VERDICT.info;
  return <span className={`verdict ${v}`}><V.icon size={14} strokeWidth={2.8} />{V.label}</span>;
}

function Stat({ v, l }) {
  return <div className="stat"><b>{v}</b><small>{l}</small></div>;
}

function ControlSheet({ item, rows, noun, total, acted, onClose }) {
  const Icon = item.icon;
  return (
    <motion.div className="scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="sheet" onClick={(e) => e.stopPropagation()} initial={{ scale: 0.97, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.98, opacity: 0 }}>
        <div className="sheet-head">
          <span className="li"><Icon size={26} /></span>
          <div><small>{noun} {item.n} of {total} {acted ? `· acted ×${acted} in this run` : ""}</small><h2>{item.name}: {item.short}</h2></div>
          <button className="btn icon x" onClick={onClose}><X size={16} /></button>
        </div>
        <dl>{rows.map(([label, text, cls]) => <span key={label} style={{ display: "contents" }}><dt>{label}</dt><dd className={cls || ""}>{text}</dd></span>)}</dl>
      </motion.div>
    </motion.div>
  );
}
