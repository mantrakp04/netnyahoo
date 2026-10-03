// Every profile colour on the Personal window, one snapshot each.
then(() => { unsplit(); return goProfile("default"); });
then(() => { st().activate("t1"); return sleep(800).then(() => picShown()); });
["plum", "blue", "purple", "pink", "red", "orange", "yellow", "green", "neutral", "plum"].forEach((color) => then(() => { st().updateProfile("default", { color }); return sleep(1200).then(() => snap("color:" + color)); }));
return finish();
