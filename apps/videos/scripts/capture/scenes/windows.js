// The utility windows: Import (from Chrome, Arc, Dia, Safari…) and Settings › Privacy.
then(() => { nn.runCommand({ command: "importBrowserData", arg: null, windowId: null }); return sleep(3000).then(() => snapWin("import", "import")); });
then(() => { nn.openSettings("privacy"); return sleep(3000).then(() => snapWin("settings", "privacy")); });
then(() => { nn.openSettings("profiles"); return sleep(2000).then(() => snapWin("settings", "profiles")); });
then(() => { nn.openSettings("appearance"); return sleep(2000).then(() => snapWin("settings", "appearance")); });
return finish();
