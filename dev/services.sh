#!/bin/zsh
# Development only: start or stop the back-end services without the desktop app (the UI is left out).
# The desktop app is the supported way to run the demo.
ROOT="${0:A:h:h}"; cd "$ROOT"; export APP_LAUNCHER=desktop
case "$1" in
  start)
    for s in gateway/gateway.py mocks/services.py orchestrator/orchestrator.py; do
      .venv/bin/python -B "$ROOT/$s" >> logs/dev-services.log 2>&1 &
    done; sleep 2; echo started ;;
  stop)
    pkill -9 -f "$ROOT/(gateway/gateway|mocks/services|orchestrator/orchestrator|ui/server)\\.py"; echo stopped ;;
esac
