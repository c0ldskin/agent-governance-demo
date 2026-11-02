"""Ports, host names and paths shared by every demo process."""
from __future__ import annotations

import os
import secrets
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOGS = ROOT / "logs"
RUN = ROOT / "run"            # runtime state: agent tokens, workspaces (never readable by a sandboxed agent)
SECRETS = ROOT / "secrets"    # the case-registry API key (only the gateway, mocks and unguarded launcher read it)
POLICIES = ROOT / "policies"
PYTHON = ROOT / ".venv" / "bin" / "python"

UI_PORT = 8776
GATEWAY_PORT = 8780
REGISTRY_PORT = 8781
ATTACKER_PORT = 8782
ORCHESTRATOR_PORT = 8783
CLOUD_PORT = 8784
OLLAMA = "127.0.0.1:11434"
MODEL = os.environ.get("DEMO_MODEL", "qwen3:8b")

# *.localhost names resolve to 127.0.0.1 on macOS without any system change, so nothing leaves the laptop.
REGISTRY_HOST = f"registry.localhost:{REGISTRY_PORT}"
ORCHESTRATOR_HOST = f"orchestrator.localhost:{ORCHESTRATOR_PORT}"
ATTACKER_HOST = f"collect.records-verify.localhost:{ATTACKER_PORT}"
CLOUD_HOST = f"api.global-llm.localhost:{CLOUD_PORT}"

KEY_FILE = SECRETS / "case-registry.key"
CONTROL_TOKEN_FILE = RUN / "control.token"
GATEWAY_SECRET_FILE = RUN / "gateway.secret"
TOKENS_FILE = RUN / "tokens.json"


def _read_or_make(path: Path, make) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_text(make())
        path.chmod(0o600)
    return path.read_text().strip()


def registry_key() -> str:
    """A random fake API key, generated on first start. Nobody types it."""
    return _read_or_make(KEY_FILE, lambda: "csr_live_" + secrets.token_hex(16))


def control_token() -> str:
    return _read_or_make(CONTROL_TOKEN_FILE, lambda: secrets.token_hex(16))


def gateway_secret() -> str:
    return _read_or_make(GATEWAY_SECRET_FILE, lambda: secrets.token_hex(16))


def require_desktop_launcher(name: str):
    if os.getenv("APP_LAUNCHER") != "desktop":
        print(f"{name}: start this demo from its desktop app (Agent Governance Demo), not from a terminal.", flush=True)
        sys.exit(2)
