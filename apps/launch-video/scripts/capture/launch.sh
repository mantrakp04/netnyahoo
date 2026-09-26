#!/bin/bash
# usage: launch.sh <data dir name> <port> [extra open args] — hidden dev instance; prints pid
L=${CAPTURE_DIR:?set CAPTURE_DIR}
# A DEV build (the harness only runs in DEV; Metro must be serving apps/browser on :8081).
APP=${APP:-$L/NetnyahooDev.app}
name=$1; port=$2; shift 2
mkdir -p $L/$name
before=$(pgrep -f "^$APP/Contents/MacOS/Netnyahoo" | sort)
open -g -n --env NETNYAHOO_BACKGROUND=1 --env NETNYAHOO_DATA_DIR=$L/$name --env NETNYAHOO_REMOTE_DEBUGGING_PORT=$port \
  --env NETNYAHOO_CHROMIUM_SWITCHES=--disable-backgrounding-occluded-windows "$@" $APP
for i in $(seq 1 60); do curl -fs localhost:$port/json/version >/dev/null && break; sleep 1; done
sleep 4
comm -13 <(echo "$before") <(pgrep -f "^$APP/Contents/MacOS/Netnyahoo" | sort) | head -1 > $L/$name.pid
cat $L/$name.pid
