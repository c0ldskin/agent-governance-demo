"""Policy engine: loads the YAML policies and decides each request. Shared by the gateway (enforcement),
the orchestrator (delegation check) and the UI (risk check on proposed changes).

Matching is on agent identity (which policy), host, method and path. Default deny: a request is allowed only
when a rule matches it. In paths, "*" matches one segment and "**" matches anything.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from fnmatch import fnmatchcase
from pathlib import Path
from urllib.parse import urlsplit

import yaml


@dataclass
class Decision:
    allowed: bool
    rule: str
    reason: str
    credential: str | None = None


def _path_regex(pattern: str) -> re.Pattern:
    parts = re.split(r"(\*\*|\*)", pattern)
    out = "".join(".*" if p == "**" else "[^/]+" if p == "*" else re.escape(p) for p in parts)
    return re.compile(f"^{out}$")


def path_matches(pattern: str, path: str) -> bool:
    return bool(_path_regex(pattern).match(path.split("?", 1)[0]))


class PolicySet:
    def __init__(self, folder: Path):
        self.folder = folder
        self.gateway: dict = {}
        self.policies: dict[str, dict] = {}
        self.stamp: tuple = ()
        self.reload()

    def _files(self):
        return sorted(self.folder.glob("*.yaml"))

    def current_stamp(self) -> tuple:
        return tuple((p.name, p.stat().st_mtime_ns) for p in self._files())

    def reload(self) -> bool:
        """Re-read the policy files if any changed. Returns True when something was reloaded."""
        stamp = self.current_stamp()
        if stamp == self.stamp:
            return False
        policies, gateway = {}, {}
        for p in self._files():
            data = yaml.safe_load(p.read_text()) or {}
            if p.stem == "gateway":
                gateway = data
            elif "agent" in data:
                policies[p.stem] = data
        self.gateway, self.policies, self.stamp = gateway, policies, stamp
        return True

    def decide(self, policy_name: str, method: str, host: str, path: str) -> Decision:
        inference = self.gateway.get("inference", {})
        if any(path_matches(p, path) for p in inference.get("model_paths", [])) \
                and host not in inference.get("allowed_hosts", []):
            return Decision(False, "inference-routing",
                            f"model call to {host} denied: inference must stay on the local model")
        policy = self.policies.get(policy_name)
        if not policy:
            return Decision(False, "default-deny", f"no policy called {policy_name}")
        for rule in policy.get("rules", []):
            if fnmatchcase(host, rule.get("host", "")) and method.upper() in rule.get("methods", []) \
                    and any(path_matches(p, path) for p in rule.get("paths", [])):
                cred = rule.get("credential")
                if cred and host not in self.gateway.get("credentials", {}).get(cred, {}).get("hosts", []):
                    cred = None   # the broker never sends a secret to a host it isn't bound to
                return Decision(True, rule["id"], rule.get("purpose", ""), cred)
        return Decision(False, "default-deny", f"no rule in {policy_name} allows {method} {host}{path}")

    def decide_url(self, policy_name: str, method: str, url: str) -> Decision:
        u = urlsplit(url)
        host = f"{u.hostname}:{u.port or (443 if u.scheme == 'https' else 80)}"
        return self.decide(policy_name, method, host, u.path or "/")


# --- risk check for proposed changes (policy as code) ---

def _destinations(doc: dict) -> set[tuple]:
    return {(r.get("host"), m, p) for r in doc.get("rules", []) for m in r.get("methods", []) for p in r.get("paths", [])}


def _credentials(doc: dict) -> set[str]:
    return {r["credential"] for r in doc.get("rules", []) if r.get("credential")}


def risk_check(old_text: str, new_text: str) -> dict:
    """Label what a change does. Adding a destination or a credential is flagged for review;
    removing one, or switching a control on, is a tightening."""
    old, new = yaml.safe_load(old_text) or {}, yaml.safe_load(new_text) or {}
    changes, level = [], "low"
    for host, method, path in sorted(_destinations(new) - _destinations(old), key=str):
        changes.append(f"ADDS destination: {method} {host}{path}")
        level = "high"
    for host, method, path in sorted(_destinations(old) - _destinations(new), key=str):
        changes.append(f"removes destination: {method} {host}{path}")
    for c in sorted(_credentials(new) - _credentials(old)):
        changes.append(f"ADDS credential use: {c}")
        level = "high"
    for c in sorted(_credentials(old) - _credentials(new)):
        changes.append(f"removes credential use: {c}")
    if "delegation_check" in old or "delegation_check" in new:
        before, after = bool(old.get("delegation_check")), bool(new.get("delegation_check"))
        if before != after:
            changes.append(f"{'turns ON' if after else 'TURNS OFF'} the delegation check")
            if not after:
                level = "high"
    summary = {"high": "Widens access: needs security review",
               "low": "Tightens access: safe to approve"}[level] if changes else "No change to access"
    return {"level": level if changes else "none", "summary": summary, "changes": changes}
