# Shared environment for the Netnyahoo engine build: plain Chromium + ungoogled-chromium + our
# series (docs/engine-build.md). Source this file.
export CB=~/chromium-build
# The Netnyahoo checkout (yahu-resource.sh reads the offline game from it).
export NN_REPO="${NN_REPO:-$HOME/Documents/netnyahoo}"
export DEPOT_TOOLS_UPDATE=0
export PATH="$CB/depot_tools:$PATH"
# The Chromium tag step 1 checks out, and the ungoogled-chromium tags made for exactly it
# (its patches and domain substitution lists are version-specific).
export CHROMIUM_VERSION=154.0.8037.97
export UNGOOGLED_TAG=154.0.8037.97-1
export UNGOOGLED_MACOS_TAG=154.0.8037.97-1.1
export GN_OUT_CONFIGS=Release_GN_arm64
# Low priority for everything heavy. CPU-bound steps (compile/link) run in the
# background QoS band (-b): on this M5 Pro that confines them to the 10
# lower-tier cores and throttles their disk I/O. Background QoS also throttles
# network traffic to a crawl, so network-bound steps (sync) use the utility
# clamp with throttled disk I/O instead.
lowprio() { taskpolicy -b nice -n 19 "$@"; }
lowprio_net() { taskpolicy -c utility -d throttle nice -n 19 "$@"; }
export DEPOT_TOOLS_METRICS=0
