"""Governance gateway: a small local HTTP forward proxy that every governed agent request goes through.

- identifies the agent by the per-process token the orchestrator issued at launch (Proxy-Authorization);
- default deny: forwards a request only when the agent's policy has a rule for its host, method and path;
- inference routing: model calls go only to the local model;
- credential broker: adds the registry API key only to allowed requests bound to that credential;
- logs every decision as one OCSF-like JSON line in logs/gateway.log, with the rule and the trace ID;
- reloads policies (and the token list) live when the files change.

Demo-grade: it shows the pattern. HTTPS (CONNECT) is always denied, because nothing in the demo needs it.
"""
from __future__ import annotations

import base64
import http.client
import json
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent
sys.path[:0] = [str(ROOT), str(ROOT / "gateway")]
from policy import PolicySet  # noqa: E402
from scenario import settings as S  # noqa: E402

HOP = {"connection", "keep-alive", "proxy-authorization", "proxy-connection", "te", "trailer",
       "transfer-encoding", "upgrade", "host", "content-length"}
STRIP = {"x-api-key", "x-agent-identity", "x-gateway-sig", "authorization"}   # agents can't bring their own

policies = PolicySet(S.POLICIES)
_lock = threading.RLock()
_tokens: dict = {"stamp": None, "map": {}}
_counts: dict[str, int] = {}
SECRET = S.gateway_secret()


def log(entry: dict):
    entry = {"time": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime()) + f".{int(time.time() * 1000) % 1000:03d}",
             "ts": time.time(), **entry}
    with _lock, open(S.LOGS / "gateway.log", "a") as f:
        f.write(json.dumps(entry) + "\n")


def refresh():
    with _lock:
        if policies.reload():
            log({"event": "policy_reload", "policies": sorted(policies.policies),
                 "message": "Policies reloaded live from policies/"})
        try:
            stamp = S.TOKENS_FILE.stat().st_mtime_ns
        except FileNotFoundError:
            stamp = None
        if stamp != _tokens["stamp"]:
            _tokens["map"] = json.loads(S.TOKENS_FILE.read_text()) if stamp else {}
            _tokens["stamp"] = stamp


def secret_for(name: str) -> tuple[str, str]:
    cfg = policies.gateway["credentials"][name]
    return cfg["header"], (S.ROOT / cfg["source"]).read_text().strip()


class Proxy(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def send_json(self, code: int, body: dict, extra: dict | None = None):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def identity(self) -> dict | None:
        auth = self.headers.get("Proxy-Authorization", "")
        if not auth.lower().startswith("basic "):
            return None
        try:
            token = base64.b64decode(auth[6:]).decode().split(":", 1)[1]
        except (ValueError, IndexError):
            return None
        return _tokens["map"].get(token) and {**_tokens["map"][token], "token": token}

    def trace_id(self) -> str | None:
        tp = self.headers.get("traceparent", "")
        return self.headers.get("X-Trace-Id") or (tp.split("-")[1] if tp.count("-") >= 3 else None)

    def decision_line(self, who, host, path, allowed, rule, reason, status=None, credential=None, size=0):
        log({"class_name": "HTTP Activity", "activity": "Request",
             "actor": {"agent": who and who["agent"], "policy": who and who["policy"],
                       "origin_agent": who and who.get("origin"), "run_id": who and who.get("run_id")},
             "dst_endpoint": {"host": host}, "http_request": {"method": self.command, "path": path, "bytes": size},
             "disposition": "Allowed" if allowed else "Blocked", "rule": rule, "reason": reason,
             "credential_injected": credential, "status": status, "trace_id": self.trace_id()})

    def do_CONNECT(self):
        refresh()
        who = self.identity()
        self.decision_line(who, self.path, "", False, "default-deny", "HTTPS tunnels are not allowed through the gateway")
        self.send_json(403, {"error": "Blocked by the governance gateway", "rule": "default-deny"})
        self.close_connection = True

    def handle_any(self):
        refresh()
        size = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(size) if size else b""
        if self.path.startswith("/"):   # not a proxy request
            if self.path == "/_health":
                return self.send_json(200, {"ok": True, "policies": sorted(policies.policies)})
            return self.send_json(400, {"error": "this is a proxy; send absolute URLs"})
        u = urlsplit(self.path)
        host = f"{u.hostname}:{u.port or 80}"
        path = u.path or "/"
        if u.query:
            path += "?" + u.query
        who = self.identity()
        if not who:
            self.decision_line(None, host, path, False, "unknown-agent", "no valid agent token", size=size)
            return self.send_json(407, {"error": "Blocked by the governance gateway: unknown agent"})
        n = _counts[who["token"]] = _counts.get(who["token"], 0) + 1
        limit = policies.gateway.get("limits", {}).get("max_requests_per_agent_process", 40)
        if n > limit:
            self.decision_line(who, host, path, False, "limit", f"request limit of {limit} reached", size=size)
            return self.send_json(429, {"error": "Blocked by the governance gateway", "rule": "limit"})
        d = policies.decide(who["policy"], self.command, host, u.path or "/")
        if not d.allowed:
            self.decision_line(who, host, path, False, d.rule, d.reason, size=size)
            return self.send_json(403, {"error": "Blocked by the governance gateway", "rule": d.rule,
                                        "reason": d.reason}, {"X-Gateway-Decision": "blocked"})
        headers = {k: v for k, v in self.headers.items() if k.lower() not in HOP | STRIP}
        headers.update({"X-Agent-Identity": who["agent"], "X-Origin-Agent": who.get("origin") or who["agent"],
                        "X-Gateway-Sig": SECRET, "Host": host})
        if d.credential:
            name, value = secret_for(d.credential)
            headers[name] = value
        try:
            conn = http.client.HTTPConnection(u.hostname, u.port or 80, timeout=180)
            conn.request(self.command, path, body=body or None, headers=headers)
            resp = conn.getresponse()
            data = resp.read()
            conn.close()
        except OSError as e:
            self.decision_line(who, host, path, True, d.rule, f"{d.reason} (upstream error: {e})", 502, d.credential, size)
            return self.send_json(502, {"error": f"upstream unreachable: {e}"})
        self.decision_line(who, host, path, True, d.rule, d.reason, resp.status, d.credential, size)
        self.send_response(resp.status)
        for k, v in resp.getheaders():
            if k.lower() not in HOP:
                self.send_header(k, v)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = do_HEAD = handle_any


def main():
    S.require_desktop_launcher("gateway")
    S.LOGS.mkdir(exist_ok=True)
    refresh()
    server = ThreadingHTTPServer(("127.0.0.1", S.GATEWAY_PORT), Proxy)
    server.daemon_threads = True
    log({"event": "gateway_start", "message": f"Gateway listening on 127.0.0.1:{S.GATEWAY_PORT}, default deny"})
    print(f"gateway ready on {S.GATEWAY_PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
