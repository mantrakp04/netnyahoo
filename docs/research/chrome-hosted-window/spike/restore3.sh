#!/bin/bash
# Session restore of a Chrome-hosted window left on its second profile, plus a second window.
here="$(cd "$(dirname "$0")" && pwd)"
SP=${SPIKE_DIR:?}; cd $SP
APP=${APP:?}
rm -rf r3
APP=$APP "$here/launch.sh" r3 9543 >/dev/null
SPIKE_DIR=$SP "$here/dev.sh" r3 'const s=nn.store.getState(); const work=s.createProfile({name:"Work",color:"blue"}); nn.actions.openUrls(["'"${PAGES:-http://localhost:8795}"'/page.html?home1"]); return work' >/dev/null
sleep 3
SPIKE_DIR=$SP "$here/dev.sh" r3 'const s=nn.store.getState(); const w=Object.keys(s.windows)[0]; s.switchProfile(w, s.profileOrder[1]); return 1' >/dev/null
sleep 2
SPIKE_DIR=$SP "$here/dev.sh" r3 'nn.actions.openUrls(["'"${PAGES:-http://localhost:8795}"'/find.html?work1"]); nn.actions.openWindow({profileId: "default"}); return 1' >/dev/null
sleep 3
st() { SPIKE_DIR=$SP "$here/dev.sh" r3 'const s=nn.store.getState(); return JSON.stringify(Object.values(s.windows).map(w=>[w.profileId.slice(0,8), w.tabIds.map(id=>(s.tabs[id]?.url||"").slice(-6))]))'; }
gh() { SPIKE_DIR=$SP "$here/dev.sh" r3 'return globalThis.expo.modules.NetnyahooCEF.chromeWindows().then(g=>JSON.stringify(g.map(x=>[x.profile.slice(0,8)||"default", x.hosting?"H":"ghost", x.hasRoot?"root":"", x.visible?"vis":"hid", x.anyTabBrowserId, x.group.slice(-4)])))'; }
echo before; st; gh
pid=$(cat r3.pid); kill -TERM $pid; for i in $(seq 1 20); do kill -0 $pid 2>/dev/null || break; sleep 1; done
APP=$APP "$here/launch.sh" r3 9543 >/dev/null
sleep 5
echo after; st; gh
curl -s localhost:9543/json | python3 -c "import sys,json; print(sorted(t['url'][-12:] for t in json.load(sys.stdin) if t['type']=='page'))"
