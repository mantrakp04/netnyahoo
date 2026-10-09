// The bench bundle's network guard, imported before the app's code (bench-entry.js). Opt-in diagnostics are on in the
// journey phases (the app only times a journey while sharing is on), and a Release bundle would send them to our
// collector: every fetch that isn't to this machine is answered here with a 200 and counted, and nothing leaves.
// `ac.blockedFetches()` (bench-channel.js) reads the count; native-bench's journey phases check the guard first.
// Only where the data folder holds a `bench-offline` file (the journey phases write it): the other phases run as before.
import { readDocument } from "@arcadia/shell";

const real = globalThis.fetch;
const blocked = [];

if (readDocument("bench-offline") !== null) {
  globalThis.fetch = function guardedFetch(input, init) {
    const url = typeof input === "string" ? input : String(input?.url ?? input);
    if (/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(url)) return real(input, init);
    blocked.push(url.replace(/[?#].*$/, ""));
    return Promise.resolve(new Response("{}", { status: 200, headers: { "x-bench-blocked": "1" } }));
  };
}

globalThis.__nnBlockedFetches = () => blocked.slice();
