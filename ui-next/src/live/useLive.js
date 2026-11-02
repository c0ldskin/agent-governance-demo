// Connects the shell to a running demo: the server's event stream feeds the demo's adapter, /api/state gives
// the run status and any pending policy proposals, and the actions call the demo's own API. When no demo is
// running (for example while designing), `connected` stays false and the shell shows the scripted mock.
import { useCallback, useEffect, useRef, useState } from "react";

export function useLive(spec) {
  const [connected, setConnected] = useState(false);
  const [, setTick] = useState(0);
  const [state, setState] = useState({ status: { running: false }, policies: null });
  const model = useRef(null);
  const es = useRef(null);
  const frame = useRef(0);

  const bump = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => { frame.current = 0; setTick((x) => x + 1); });
  }, []);
  const refresh = useCallback(async () => {
    try { const r = await fetch("/api/state"); if (r.ok) setState(await r.json()); } catch { /* demo stopping */ }
  }, []);

  useEffect(() => {
    if (!spec) return;
    let alive = true;
    fetch("/api/ping").then((r) => { if (alive && r.ok) setConnected(true); }).catch(() => {});
    return () => { alive = false; };
  }, [spec]);

  useEffect(() => {
    if (!spec || !connected) return;
    model.current = spec.createModel();
    refresh();
    const src = new EventSource("/api/stream");
    es.current = src;
    src.onmessage = (m) => {
      const item = JSON.parse(m.data);
      if (item.src === "reset") model.current = spec.createModel();
      else model.current.push(item);
      if ((item.src === "event" && ["run_start", "run_end", "reset"].includes(item.d.ev)) || item.src === "governance") refresh();
      bump();
    };
    return () => src.close();
  }, [spec, connected, bump, refresh]);

  const post = useCallback(async (path, body = {}) => {
    const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.detail || data.message || r.statusText);
    refresh();
    return data;
  }, [refresh]);

  if (!spec || !connected || !model.current) return null;
  return {
    model: model.current, state, refresh,
    run: (act, mode) => post("/api/run", { act, mode }),
    stop: () => post("/api/stop"),
    reset: () => post("/api/reset"),
    approve: (file) => post("/api/approve", { file }),
    close: async () => { await post("/api/close"); es.current?.close(); },
  };
}
