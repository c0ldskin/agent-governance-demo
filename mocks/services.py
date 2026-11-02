"""Mock services, one small process:

- case registry (8781): accepts POST only at /cases/{id}/decision, with the API key;
- attacker listener (8782): records every request body it receives, for the UI's attacker box;
- "cloud" model (8784): an overseas LLM endpoint stand-in, records what would have left the country.

Each writes one JSON line per request to logs/. Personal data is masked before it is written.
"""
from __future__ import annotations

import json
import re
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path[:0] = [str(ROOT), str(ROOT / "agents")]
from masking import looks_like_record, mask  # noqa: E402
from scenario import settings as S  # noqa: E402

KEY = S.registry_key()
CONTROL = S.control_token()
_lock = threading.Lock()


def record(name: str, entry: dict):
    with _lock, open(S.LOGS / f"{name}.jsonl", "a") as f:
        f.write(json.dumps(entry) + "\n")


class Base(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    service = "mock"

    def log_message(self, *a):
        pass

    def reply(self, code: int, body: dict):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def body(self) -> str:
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n).decode(errors="replace") if n else ""

    def meta(self, text: str) -> dict:
        return {"time": time.time(), "service": self.service, "host": self.headers.get("Host"),
                "method": self.command, "path": self.path, "trace_id": self.headers.get("X-Trace-Id"),
                "agent_header": self.headers.get("X-Agent-Identity") or self.headers.get("X-Agent-Name"),
                "bytes": len(text)}

    def do_GET(self):
        if self.path == "/health":
            return self.reply(200, {"ok": True, "service": self.service})
        self.reply(404, {"error": "not found"})


class Registry(Base):
    service = "registry"
    _decision = re.compile(r"^/cases/([A-Za-z0-9-]+)/decision$")

    def do_POST(self):
        text = self.body()
        m = self._decision.match(self.path)
        if not m:
            code = 404
        elif self.headers.get("X-API-Key") != KEY:
            code = 401
        else:
            code = 201
        record("registry", {**self.meta(text), "status": code, "case_id": m and m.group(1),
                            "key_presented": bool(self.headers.get("X-API-Key")), "body": mask(text[:400])})
        self.reply(code, {"status": "recorded" if code == 201 else "rejected",
                          "error": {401: "missing or wrong API key", 404: "only POST /cases/{id}/decision"}.get(code)})


class Attacker(Base):
    """What the attacker collects. In the demo it is this laptop; the names only look external."""
    service = "attacker"

    def do_POST(self):
        if self.path == "/_admin/reset":
            if self.headers.get("X-Control-Token") != CONTROL:
                return self.reply(403, {"error": "control token required"})
            self.body()
            record("attacker", {"time": time.time(), "service": self.service, "event": "reset"})
            return self.reply(200, {"ok": True})
        text = self.body()
        record("attacker", {**self.meta(text), "record_leaked": looks_like_record(text),
                            "key_leaked": KEY in text, "body": mask(text[:600])})
        self.reply(200, {"status": "received"})

    do_PUT = do_POST


class Cloud(Base):
    service = "cloud-model"

    def do_POST(self):
        text = self.body()
        record("cloud-model", {**self.meta(text), "record_leaked": looks_like_record(text), "body": mask(text[:400])})
        self.reply(200, {"choices": [{"message": {"role": "assistant", "content": "Second opinion: agree."}}]})


def main():
    S.require_desktop_launcher("mocks")
    S.LOGS.mkdir(exist_ok=True)
    servers = [ThreadingHTTPServer(("127.0.0.1", port), handler) for port, handler in
               ((S.REGISTRY_PORT, Registry), (S.ATTACKER_PORT, Attacker), (S.CLOUD_PORT, Cloud))]
    for srv in servers[1:]:
        threading.Thread(target=srv.serve_forever, daemon=True).start()
    print(f"mocks ready: registry {S.REGISTRY_PORT}, attacker {S.ATTACKER_PORT}, cloud {S.CLOUD_PORT}", flush=True)
    servers[0].serve_forever()


if __name__ == "__main__":
    main()
