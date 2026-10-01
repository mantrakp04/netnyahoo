# Shared environment for the Netnyahoo CEF source build (source this file).
export CB=~/chromium-build
# The Netnyahoo checkout (yahu-resource.sh reads the offline game from it).
export NN_REPO="${NN_REPO:-$HOME/Documents/netnyahoo}"
export DEPOT_TOOLS_UPDATE=0
export PATH="$CB/depot_tools:$PATH"
export CEF_BRANCH=8037
export CEF_USE_GN=1
export CEF_ENABLE_ARM64=1
export GN_OUT_CONFIGS=Release_GN_arm64
export CEF_ARCHIVE_FORMAT=tar.bz2
# Low priority for everything heavy. CPU-bound steps (compile/link) run in the
# background QoS band (-b): on this M5 Pro that confines them to the 10
# lower-tier cores and throttles their disk I/O. Background QoS also throttles
# network traffic to a crawl, so network-bound steps (sync) use the utility
# clamp with throttled disk I/O instead.
lowprio() { taskpolicy -b nice -n 19 "$@"; }
lowprio_net() { taskpolicy -c utility -d throttle nice -n 19 "$@"; }
export DEPOT_TOOLS_METRICS=0
