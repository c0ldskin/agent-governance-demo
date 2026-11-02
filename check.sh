#!/bin/zsh
# Check this Mac is ready for the Agent Governance Demo. Read-only: it installs, downloads and changes nothing.
#   ./check.sh
ROOT="${0:A:h}"; FAIL=0
ok()   { print -P "%F{green}✓%f $1"; }
bad()  { print -P "%F{red}✗%f $1"; print "    $2"; FAIL=1; }
warn() { print -P "%F{yellow}!%f $1"; print "    $2"; }

[[ "$(uname -s)" == Darwin ]] && ok "macOS $(sw_vers -productVersion)" \
  || bad "Not macOS" "The OS sandbox uses macOS's built-in sandbox-exec, so this demo runs on macOS only."
[[ "$(uname -m)" == arm64 ]] && ok "Apple silicon" \
  || warn "Not Apple silicon" "Untested on Intel Macs: the sandbox profiles expect Homebrew under /opt/homebrew."
[[ -x /usr/bin/sandbox-exec ]] && ok "sandbox-exec present" \
  || bad "sandbox-exec missing" "It ships with macOS; without it the OS-sandbox layer can't run."

PY=/opt/homebrew/opt/python@3.14/bin/python3.14
[[ -x $PY ]] && ok "Homebrew Python 3.14 ($PY)" \
  || bad "Homebrew Python 3.14 not found at $PY" "Install it with: brew install python@3.14"
command -v uv >/dev/null && ok "uv $(uv --version 2>/dev/null | awk '{print $2}')" \
  || bad "uv not found" "Install it with: brew install uv"
command -v git >/dev/null && ok "git" || bad "git not found" "Install it with: xcode-select --install"

if command -v ollama >/dev/null; then
  ok "Ollama installed"
  if ollama list 2>/dev/null | grep -q '^qwen3:8b'; then ok "Model qwen3:8b pulled"
  elif curl -s -m 2 http://127.0.0.1:11434/api/tags >/dev/null; then
    bad "Model qwen3:8b not pulled" "Pull it once with: ollama pull qwen3:8b  (about 5 GB)"
  elif [[ -e "${OLLAMA_MODELS:-$HOME/.ollama/models}/manifests/registry.ollama.ai/library/qwen3/8b" ]]; then
    ok "Model qwen3:8b pulled (Ollama isn't running; the launcher starts it)"
  else bad "Model qwen3:8b not found" "Start Ollama and pull it once with: ollama pull qwen3:8b  (about 5 GB)"
  fi
else bad "Ollama not found" "Install it from https://ollama.com, then: ollama pull qwen3:8b"; fi

RAM=$(( $(sysctl -n hw.memsize) / 1073741824 ))
(( RAM >= 16 )) && ok "${RAM} GB of RAM" \
  || warn "${RAM} GB of RAM" "The model needs about 5.3 GB when loaded; close other apps before running."

BUSY=()
for p in 8776 8780 8781 8782 8783 8784; do lsof -nP -iTCP:$p -sTCP:LISTEN >/dev/null 2>&1 && BUSY+=($p); done
(( ${#BUSY} == 0 )) && ok "Ports 8776 and 8780–8784 are free" \
  || warn "Ports in use: ${BUSY[*]}" "Close whatever uses them (another copy of this demo?) before starting."

APP=0; [[ -e "$HOME/Desktop/Agent Governance Demo.app" ]] && { APP=1; ok "Desktop app installed"; } \
  || warn "Desktop app not installed yet" "Run: $ROOT/launcher/install-desktop.sh"

print
(( FAIL )) && { print "Fix the items marked ✗, then run ./check.sh again."; exit 1; }
(( APP )) && print "Ready. Double-click Agent Governance Demo on the Desktop." \
  || print "Ready. Next: run launcher/install-desktop.sh, then double-click Agent Governance Demo on the Desktop."
