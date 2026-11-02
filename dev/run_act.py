"""Development: trigger one act through the orchestrator and print what happened.

    .venv/bin/python dev/run_act.py poisoned unguarded [--quiet]
    .venv/bin/python dev/run_act.py deputy governed
Prints a JSON scorecard as the last line (the same one the UI shows).
"""
from __future__ import annotations

import json
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path[:0] = [str(ROOT), str(ROOT / "ui")]
from scenario import settings as S  # noqa: E402
from scorecard import scorecard  # noqa: E402


def post(path: str, body: dict) -> dict:
    req = urllib.request.Request(f"http://127.0.0.1:{S.ORCHESTRATOR_PORT}{path}", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json", "X-Control-Token": S.control_token()})
    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req, timeout=10) as r:
        return json.load(r)


def main():
    act, mode = sys.argv[1], sys.argv[2]
    quiet = "--quiet" in sys.argv
    events = S.LOGS / "events.jsonl"
    offset = events.stat().st_size if events.exists() else 0
    run_id = post("/control/run", {"act": act, "mode": mode})["run_id"]
    t0 = time.time()
    while True:
        time.sleep(0.5)
        with open(events) as f:
            f.seek(offset)
            lines = f.readlines()
            offset = f.tell()
        done = False
        for line in lines:
            e = json.loads(line)
            if e.get("run_id") != run_id:
                continue
            if not quiet and e["ev"] in ("tool", "handoff", "handoff_refused", "sandbox_probe", "second_opinion",
                                         "agent_start", "agent_exit", "error", "run_end"):
                detail = {k: v for k, v in e.items() if k not in ("ts", "run_id", "ev")}
                print(f"{e['ts'] - t0:6.1f}s {e['ev']:16s} {json.dumps(detail)[:220]}")
            if e["ev"] == "run_end":
                done = True
        if done:
            break
    print(json.dumps(scorecard(run_id)))


if __name__ == "__main__":
    main()
