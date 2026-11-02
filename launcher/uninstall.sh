#!/bin/zsh
# Remove the Agent Governance Demo: its Desktop app and its
# folder. Nothing is deleted: the app and the folder are moved to ~/agent-governance-trash.
# Never touches Ollama, the qwen3:8b model, or anything else on the machine.
ROOT="${0:A:h:h}"; BIN="$HOME/agent-governance-trash"; STAMP=$(date +%Y%m%d-%H%M%S)
if curl -s -m 2 --noproxy '*' http://127.0.0.1:8776/api/ping >/dev/null; then
  echo "The demo is running. Close it first (Close button in the page)."; exit 1
fi
mkdir -p "$BIN"
[ -e "$HOME/Desktop/Agent Governance Demo.app" ] && mv "$HOME/Desktop/Agent Governance Demo.app" "$BIN/Agent Governance Demo.app-$STAMP" \
  && echo "Moved the Desktop app to $BIN"
cd "$HOME"; mv "$ROOT" "$BIN/agent-governance-demo-$STAMP" && echo "Moved the demo folder to $BIN/agent-governance-demo-$STAMP"
