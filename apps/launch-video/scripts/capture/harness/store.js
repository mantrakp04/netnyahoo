setTimeout(() => { nn.extensions.confirmInstall(); log.push({ confirm: Date.now() }); }, 4300);
return snapFor("store", "store", 7500).then(() => JSON.stringify({ log, install: nn.extensions.useExtensions.getState().install }));
