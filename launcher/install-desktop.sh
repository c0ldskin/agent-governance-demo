#!/bin/zsh
# Put the Agent Governance Demo app on the Desktop (the only supported way to start the demo).
# An existing copy is moved to ~/agent-governance-trash, never deleted.
ROOT="${0:A:h:h}"; APP="$HOME/Desktop/Agent Governance Demo.app"
if [ -e "$APP" ]; then
  BIN="$HOME/agent-governance-trash/Agent Governance Demo.app-$(date +%Y%m%d-%H%M%S)"; mkdir -p "${BIN:h}"; mv "$APP" "$BIN"
  echo "Moved the previous copy to $BIN"
fi
cp -R "$ROOT/launcher/Agent Governance Demo.app" "$APP"
# Point the installed app at this checkout, wherever it was cloned.
sed -i '' "s|\${GOV_DEMO_HOME:-\$HOME/agent-governance}|\${GOV_DEMO_HOME:-$ROOT}|" "$APP/Contents/MacOS/launch"
echo "Installed $APP"
