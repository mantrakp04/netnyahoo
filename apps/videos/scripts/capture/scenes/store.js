// Any extension from the Chrome Web Store, in the Work profile.
let tabId;
then(() => { unsplit(); return goProfile("work"); });
then(() => { tabId = st().newTab(W, { url: "https://chromewebstore.google.com/detail/dark-reader/eimadpbcbfnmbkopoojfekhnkhdbieeh" }); return sleep(8000).then(() => picShown()).then(() => snap("store")); });
then(() => { st().closeTab(tabId); st().activate("t7"); return goProfile("default"); });
return finish();
