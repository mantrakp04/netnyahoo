#!/bin/bash
# Session restore across a relaunch: two windows, two profiles, Chrome-hosted.
# usage: SPIKE_DIR=<scratch> APP=<Netnyahoo.app> restore.sh (pages served at localhost:8795, see chrome-hosted-window.md)
here="$(cd "$(dirname "$0")" && pwd)"
SP=${SPIKE_DIR:?set SPIKE_DIR}
cd $SP
APP=${APP:?set APP to the Netnyahoo.app to test}
rm -rf rs
APP=$APP "$here/launch.sh" rs 9537 --env NETNYAHOO_CHROME_WINDOW=1 >/dev/null
"$here/dev.sh" rs 'const s=nn.store.getState(); const work=s.createProfile({name:"Work",color:"blue"}); nn.actions.openUrls(["http://localhost:8795/page.html?rs1"]); nn.actions.openWindow({profileId: work}); return work' >/dev/null
sleep 3
"$here/dev.sh" rs 'const s=nn.store.getState(); const ids=Object.keys(s.windows); s.newTab(ids[1],{url:"http://localhost:8795/find.html?rs2"}); return ids' >/dev/null
sleep 3
state() { "$here/dev.sh" rs 'const s=nn.store.getState(); return JSON.stringify(Object.values(s.windows).map(w=>[w.profileId.slice(0,8), w.tabIds.map(id=>(s.tabs[id]?.url||"").slice(-8)), w.frame]))'; }
ghosts() { "$here/dev.sh" rs 'return globalThis.expo.modules.NetnyahooCEF.ghostWindows().then(g=>g.map(x=>[x.profile.slice(0,8),x.hosting,x.companion,x.window,x.anyTabBrowserId]))'; }
echo "before:"; state; ghosts
pid=$(cat rs.pid)
kill -TERM $pid
for i in $(seq 1 20); do kill -0 $pid 2>/dev/null || break; sleep 1; done
APP=$APP "$here/launch.sh" rs 9537 --env NETNYAHOO_CHROME_WINDOW=1 >/dev/null
sleep 5
echo "after:"; state; ghosts
"$SP/windows" $(cat rs.pid)
curl -s localhost:9537/json | python3 -c "import sys,json; print([t['url'][-12:] for t in json.load(sys.stdin) if t['type']=='page'])"
