#!/bin/bash
# usage: dev.sh <data dir name> '<js body returning a value>' — runs it through the dev harness
SP=${SPIKE_DIR:?set SPIKE_DIR}
id=e$RANDOM$RANDOM
printf '// %s\n%s\n' "$id" "$2" > $SP/$1/dev-eval.js
for i in $(seq 1 30); do grep -q "\"$id\"" $SP/$1/dev-eval-result.json 2>/dev/null && break; sleep 0.3; done
cat $SP/$1/dev-eval-result.json; echo
