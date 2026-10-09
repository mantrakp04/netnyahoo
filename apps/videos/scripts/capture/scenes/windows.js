// The utility windows: Import (from Chrome, Arc, Dia, Safari…) and Settings › Privacy.
then(() => { ac.runCommand({ command: "importBrowserData", arg: null, windowId: null }); return sleep(3000).then(() => snapWin("import", "import")); });
then(() => { ac.openSettings("privacy"); return sleep(3000).then(() => snapWin("settings", "privacy")); });
then(() => { ac.openSettings("profiles"); return sleep(2000).then(() => snapWin("settings", "profiles")); });
then(() => { ac.openSettings("appearance"); return sleep(2000).then(() => snapWin("settings", "appearance")); });
return finish();
