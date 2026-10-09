// What the popup sees of its window: chrome.windows identity and the active tab.
chrome.windows.getCurrent({ populate: true }, (win) => {
  const active = win.tabs.find((t) => t.active);
  const text = `window ${win.id} tabs ${win.tabs.length} active ${active && active.url}`;
  document.getElementById("out").textContent = text;
  document.title = JSON.stringify({ windowId: win.id, tabs: win.tabs.length, activeUrl: active && active.url });
});
