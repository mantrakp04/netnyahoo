const until = (cond, ms) => new Promise((res) => { const end = Date.now() + ms; const tick = () => (cond() || Date.now() > end ? res() : setTimeout(tick, 30)); tick(); });
let confirmed = false;
until(() => nn.extensions.useExtensions.getState().install?.prompt, 8000)
  .then(() => sleep(900)).then(() => { confirmed = true; log.push({ confirm: Date.now() }); return nn.extensions.confirmInstall(); });
return snapFor("store", "store", 7000).then(() => JSON.stringify({ log, confirmed }));
