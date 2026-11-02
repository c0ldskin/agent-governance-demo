#!/bin/zsh
# Development: run act 1 unguarded N times (presentation settings) and count how often the attack succeeds.
ROOT="${0:A:h:h}"; cd "$ROOT"; N=${1:-10}; ok=0
for i in $(seq 1 $N); do
  line=$(.venv/bin/python dev/run_act.py poisoned unguarded --quiet | tail -1); echo "$line" >> logs/attack-rate.jsonl
  echo "$line" | grep -q '"records_leaked": [1-9]' && echo "$line" | grep -q '"keys_leaked": [1-9]' && ok=$((ok+1))
  echo "run $i: $(echo $line | .venv/bin/python -c 'import sys,json;d=json.load(sys.stdin);print(d["seconds"],"s records",d["records_leaked"],"keys",d["keys_leaked"])')"
done
echo "attack succeeded (record AND key stolen) in $ok of $N runs"
