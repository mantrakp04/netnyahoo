#!/bin/bash
# usage: launch.sh <data dir name> <port> [extra --env args...] — hidden spike instance; prints pid
SP=${SPIKE_DIR:-$PWD}
APP=${APP:-$(git -C "$(dirname "$0")" rev-parse --show-toplevel)/apps/browser/build-spike/Build/Products/Debug/Netnyahoo.app}
name=$1; port=$2; shift 2
mkdir -p $SP/$name
before=$(pgrep -f "^$APP/Contents/MacOS/Netnyahoo" | sort)
open -g -n --env NETNYAHOO_BACKGROUND=1 --env NETNYAHOO_DATA_DIR=$SP/$name --env NETNYAHOO_REMOTE_DEBUGGING_PORT=$port \
  --env NETNYAHOO_CHROMIUM_SWITCHES=--disable-backgrounding-occluded-windows "$@" $APP
for i in $(seq 1 40); do curl -fs localhost:$port/json/version >/dev/null && break; sleep 1; done
sleep 5
comm -13 <(echo "$before") <(pgrep -f "^$APP/Contents/MacOS/Netnyahoo" | sort) | head -1 > $SP/$name.pid
cat $SP/$name.pid
