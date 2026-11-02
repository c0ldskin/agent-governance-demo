"""Demo UI: one local page (FastAPI + server-sent events) on 127.0.0.1:8776.

It never asks the agents what happened. It tails the logs the independent components write (the
orchestrator's events, the gateway's decision log, what the mocks received, the agents' trace files)
and streams every new line to the page. It also runs the policy-as-code flow: diff, risk check,
approve, git commit, live reload, governance audit line.
"""
from __future__ import annotations

import argparse
import asyncio
import difflib
import json
import os
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parent.parent
sys.path[:0] = [str(ROOT), str(ROOT / "gateway"), str(ROOT / "ui")]
from policy import risk_check  # noqa: E402
from scenario import settings as S  # noqa: E402
from scorecard import scorecard  # noqa: E402

GIT_ID = ["-c", "user.name=Demo presenter", "-c", "user.email=presenter@example.invalid"]   # author of approved policy commits
PROPOSALS = [  # (live file, why) in the order act 2 applies them
    ("decision-loose.yaml", "Fix 1 · Tighten the decision agent's POST rule to the registry's decision path"),
    ("orchestrator.yaml", "Fix 2 · Turn on the delegation check for handoffs"),
]
SOURCES = {"events.jsonl": "event", "gateway.log": "gateway", "attacker.jsonl": "attacker",
           "cloud-model.jsonl": "cloud", "registry.jsonl": "registry", "governance-audit.log": "governance"}


class Feed:
    """Tails the log files and keeps every line written since the last Reset."""

    def __init__(self):
        self.lock = threading.Lock()
        self.items: list[dict] = []
        self.generation = 0
        self.offsets: dict[str, int] = {}
        self.epoch = time.time()
        for path in self._paths():   # start at the end: a fresh launch shows a clean screen
            self.offsets[str(path)] = path.stat().st_size

    def _paths(self):
        paths = [S.LOGS / name for name in SOURCES if (S.LOGS / name).exists()]
        return paths + sorted((S.LOGS / "traces").glob("*.jsonl"))

    def add(self, src: str, data: dict):
        with self.lock:
            self.items.append({"src": src, "d": data})

    def poll(self):
        for path in self._paths():
            key = str(path)
            off = self.offsets.get(key, 0)
            size = path.stat().st_size
            if size < off:
                off = 0
            if size == off:
                continue
            with open(path) as f:
                f.seek(off)
                chunk = f.read()
            complete = chunk.rsplit("\n", 1)[0] if "\n" in chunk else ""
            self.offsets[key] = off + len(complete.encode()) + (1 if complete else 0)
            for line in complete.splitlines():
                try:
                    data = json.loads(line)
                except json.JSONDecodeError:
                    continue
                src = "span" if path.parent.name == "traces" else SOURCES[path.name]
                if src == "span":
                    data = {"name": data.get("name"), "trace_id": (data.get("context") or {}).get("trace_id", "")[2:],
                            "service": (data.get("resource") or {}).get("attributes", {}).get("service.name"),
                            "start": data.get("start_time"), "end": data.get("end_time"),
                            "attributes": {k: v for k, v in (data.get("attributes") or {}).items()
                                           if k in ("agent.step", "tool.args", "llm.model", "agent.origin")}}
                self.add(src, data)
                if src == "event" and data.get("ev") == "run_end":
                    self.add("scorecard", scorecard(data["run_id"]))

    def reset(self):
        self.poll()
        with self.lock:
            self.items = []
            self.generation += 1
            self.epoch = time.time()


feed = Feed()
app = FastAPI()
app.state.last_seen = time.monotonic()
STATIC = Path(__file__).parent / "static"
NO_CACHE = {"Cache-Control": "no-store"}   # the page always matches the code on disk
KIT = Path(__file__).parent / "kit"
app.mount("/kit", StaticFiles(directory=KIT, check_dir=False), name="kit")   # hashed asset names, so caching is safe


def orchestrator(method: str, path: str, body: dict | None = None) -> dict:
    req = urllib.request.Request(f"http://127.0.0.1:{S.ORCHESTRATOR_PORT}{path}", method=method,
                                 data=json.dumps(body or {}).encode() if method == "POST" else None,
                                 headers={"Content-Type": "application/json", "X-Control-Token": S.control_token()})
    try:
        with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req, timeout=10) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        raise HTTPException(e.code, json.loads(e.read() or b"{}").get("detail", "orchestrator error"))


def git(*args: str) -> str:
    return subprocess.run(["git", "-C", str(S.ROOT), *GIT_ID, *args], capture_output=True, text=True,
                          check=True).stdout.strip()


def governance_log(entry: dict):
    with open(S.LOGS / "governance-audit.log", "a") as f:
        f.write(json.dumps({"time": time.strftime("%Y-%m-%dT%H:%M:%S"), "ts": time.time(), **entry}) + "\n")


@app.middleware("http")
async def touch(request, call_next):
    app.state.last_seen = time.monotonic()   # any page or API request keeps the demo up
    return await call_next(request)


@app.get("/")
def kit():
    """The default view: the React demo kit, built from ui-next/ into ui/kit/ (npm run build)."""
    return FileResponse(KIT / "index.html", headers=NO_CACHE)


@app.get("/guide")
def guide():
    """The earlier guided, step-by-step view (the narrated video records this one)."""
    return FileResponse(STATIC / "guide.html", headers=NO_CACHE)


@app.get("/detail")
def detail():
    """The detailed three-panel view."""
    return FileResponse(STATIC / "index.html", headers=NO_CACHE)


@app.get("/api/doc/{case_id}/{name}")
def document(case_id: str, name: str):
    """One uploaded case document, as the agents see it (synthetic data; the guided view shows the hidden text)."""
    path = S.ROOT / "scenario" / "cases" / Path(case_id).name / Path(name).name
    if path.suffix != ".md" or not path.exists():
        raise HTTPException(404)
    return {"name": path.name, "text": path.read_text()}


@app.get("/static/{name}")
def static(name: str):
    path = STATIC / Path(name).name
    if not path.exists():
        raise HTTPException(404)
    return FileResponse(path, headers=NO_CACHE)


@app.get("/api/ping")
def ping():
    return {"ok": True, "demo": "agent-governance"}


@app.get("/api/stream")
async def stream(request: Request):
    async def gen():
        gen_id, i = feed.generation, 0
        yield "retry: 2000\n\n"
        while not getattr(app.state, "server", None) or not app.state.server.should_exit:
            if feed.generation != gen_id:
                gen_id, i = feed.generation, 0
                yield f"data: {json.dumps({'src': 'reset'})}\n\n"
            items = feed.items
            while i < len(items):
                yield f"data: {json.dumps(items[i])}\n\n"
                i += 1
            if await request.is_disconnected():
                return   # the browser window has gone: stop counting it as present
            app.state.last_seen = time.monotonic()
            await asyncio.sleep(0.3)
    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


def policy_view() -> dict:
    live = {p.name: p.read_text() for p in sorted(S.POLICIES.glob("*.yaml"))}
    pending = []
    for name, title in PROPOSALS:
        proposed = (S.POLICIES / "proposals" / name).read_text()
        if proposed != live[name]:
            diff = "".join(difflib.unified_diff(live[name].splitlines(True), proposed.splitlines(True),
                                                f"policies/{name} (live)", f"policies/{name} (proposed)"))
            pending.append({"file": name, "title": title, "diff": diff, "risk": risk_check(live[name], proposed)})
    return {"live": live, "pending": pending, "commit": git("log", "-1", "--format=%h %s", "--", "policies")}


@app.get("/api/state")
def state():
    try:
        status = orchestrator("GET", "/control/status")
    except Exception:   # noqa: BLE001
        status = {"running": False, "error": "orchestrator unreachable"}
    return {"policies": policy_view(), "status": status}


@app.post("/api/run")
def run(body: dict):
    return orchestrator("POST", "/control/run", body)


@app.post("/api/stop")
def stop():
    return orchestrator("POST", "/control/stop", {})


@app.post("/api/approve")
def approve(body: dict):
    name = body.get("file")
    if name not in dict(PROPOSALS):
        raise HTTPException(400, "unknown proposal")
    live, proposed = (S.POLICIES / name), (S.POLICIES / "proposals" / name)
    old, new = live.read_text(), proposed.read_text()
    if old == new:
        return {"ok": True, "message": "already applied"}
    risk = risk_check(old, new)
    live.write_text(new)   # the gateway and orchestrator pick it up on their next request
    git("add", f"policies/{name}")
    git("commit", "-q", "-m", f"Policy change approved by presenter: {dict(PROPOSALS)[name]}",
        "-m", "Risk check: " + risk["summary"] + "\n" + "\n".join(risk["changes"]))
    sha = git("rev-parse", "--short", "HEAD")
    governance_log({"event": "policy_approved", "approver": "presenter (demo UI)", "file": f"policies/{name}",
                    "title": dict(PROPOSALS)[name], "risk": risk, "commit": sha,
                    "message": f"Approved and committed {sha}; gateway and orchestrator reload it live"})
    return {"ok": True, "commit": sha, "risk": risk}


def restore_baseline(who: str):
    """Put policies/ back to the baseline tag, committing only if something changed."""
    git("checkout", "policy-baseline", "--", "policies")
    if subprocess.run(["git", "-C", str(S.ROOT), "diff", "--cached", "--quiet", "--", "policies"]).returncode:
        git("commit", "-q", "-m", "Reset policies to the demo baseline (tag policy-baseline)")
        governance_log({"event": "policy_reset", "approver": who, "commit": git("rev-parse", "--short", "HEAD"),
                        "message": "Policies restored to the baseline from git"})


@app.post("/api/reset")
def reset():
    t0 = time.time()
    orchestrator("POST", "/control/reset", {})
    restore_baseline("presenter (Reset)")
    try:
        req = urllib.request.Request(f"http://127.0.0.1:{S.ATTACKER_PORT}/_admin/reset", data=b"{}", method="POST",
                                     headers={"X-Control-Token": S.control_token()})
        urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req, timeout=5).read()
    except OSError:
        pass
    time.sleep(0.6)   # let the gateway's reload line land before the screen is cleared
    feed.reset()
    return {"ok": True, "seconds": round(time.time() - t0, 1)}


@app.post("/api/close")
def close():
    status = orchestrator("GET", "/control/status")
    if status.get("running"):
        return JSONResponse({"ok": False, "message": "A run is in progress. Stop it first."}, 409)
    threading.Timer(0.5, lambda: setattr(app.state.server, "should_exit", True)).start()
    return {"ok": True}


def main():
    S.require_desktop_launcher("ui")
    ap = argparse.ArgumentParser()
    ap.add_argument("--idle-exit", type=int, default=0, help="stop after this many seconds with no browser (0 = never)")
    args = ap.parse_args()
    restore_baseline("demo start")   # every launch starts from the baseline, even after a crash mid-act
    feed.reset()

    def tail():
        while True:
            try:
                feed.poll()
            except Exception as e:   # noqa: BLE001 - keep tailing; the error is in server.log
                print("feed error:", e, flush=True)
            time.sleep(0.3)
    threading.Thread(target=tail, daemon=True).start()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=S.UI_PORT, log_level="warning",
                                           timeout_graceful_shutdown=2))
    app.state.server = server
    if args.idle_exit:
        def watchdog():
            while not server.should_exit:
                time.sleep(5)
                try:
                    running = orchestrator("GET", "/control/status").get("running")
                except Exception:   # noqa: BLE001
                    running = False
                if running:   # never stop during a run
                    app.state.last_seen = time.monotonic()
                elif time.monotonic() - app.state.last_seen > args.idle_exit:
                    print("No browser for a while; stopping.", flush=True)
                    server.should_exit = True
        threading.Thread(target=watchdog, daemon=True).start()
    print(f"UI ready on http://127.0.0.1:{S.UI_PORT}", flush=True)
    server.run()


if __name__ == "__main__":
    main()
