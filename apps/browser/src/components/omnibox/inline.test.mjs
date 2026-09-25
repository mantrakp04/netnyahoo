// Inline autocompletion in the command bar's field (inline.ts + core's buildSuggestions), run
// against a model of the native field: keys, the field's `completeInline`, React Native's own
// controlled-value writes and JS's handling all interleave, as they do across the bridge.
// Run from apps/browser:  node --import ./src/store/test-loader.mjs --test src/components/omnibox/inline.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSuggestions } from "@netnyahoo/core";
import { completionToWrite, fieldChange, withoutFirst } from "./inline.ts";

const now = Date.UTC(2026, 8, 25);
const history = [
  {
    url: "https://mail.google.com/mail/u/0/?service=mail&continue=https%3A%2F%2Faccounts.google.com%2FServiceLogin%3FflowName%3DGlifWebSignIn%26flowEntry%3DAccountChooser%26ec%3Dasw-gmail-globalnav-signin#inbox",
    title: "Inbox - me@gmail.com - Gmail",
    favicon: null,
    visits: 60,
    lastVisit: now - 1000,
  },
  { url: "https://accounts.google.com/v3/signin/identifier?continue=https%3A%2F%2Fmail.google.com&flowName=GlifWebSignIn", title: "Sign in", favicon: null, visits: 5, lastVisit: now - 5000 },
  { url: "https://x.com/home", title: "Home / X", favicon: null, visits: 30, lastVisit: now - 2000 },
];
const suggest = (text) => (text.trim() ? buildSuggestions(text, { tabs: [], history }, { now }).completion : "");

/**
 * The field's side of `completeInline` (packages/shell/ios/InlineCompletion.swift): shows `inline`
 * if the field shows `inline.typed` with the caret after it or the rest of its text (an earlier
 * completion) selected; null (nothing changes) otherwise.
 */
function applyInline({ text, selection }, inline) {
  const n = inline.typed.length;
  if (!text.startsWith(inline.typed) || selection.start !== n || selection.end !== text.length) return null;
  const next = inline.typed + inline.completion;
  return { text: next, selection: { start: n, end: next.length } };
}

/**
 * The field (main thread), JS (the bar: Omnibox + useInlineCompletion) and the queues between
 * them. `step(pick)` runs one of the runnable things; `pick(n)` chooses which (the schedule).
 */
function world() {
  const field = { text: "", selection: { start: 0, end: 0 }, count: 0 };
  const main = []; // field-side work queued by JS: completeInline calls, RN text writes, RN's selection hop
  const events = []; // onChange events on their way to JS
  const results = []; // completeInline promises resolving in JS
  const js = { typed: "", suppress: true, inline: null, pending: [], heard: "", lastNativeText: "", mostRecentEventCount: 0 };
  const shown = () => (js.inline?.typed === js.typed ? js.inline.completion : "");

  const emit = () => events.push({ text: field.text, count: field.count });
  const change = (text, selection) => {
    field.text = text;
    field.selection = selection;
    field.count++;
    emit();
  };
  const key = (k) => {
    const { text, selection: s } = field;
    if (k === "⌫") {
      const from = s.start === s.end ? Math.max(0, s.start - 1) : s.start;
      change(text.slice(0, from) + text.slice(s.end), { start: from, end: from });
    } else {
      change(text.slice(0, s.start) + k + text.slice(s.end), { start: s.start + 1, end: s.start + 1 });
    }
  };

  /** After every JS render: the hook's layout effect, then TextInput's controlled-value sync. */
  const rendered = () => {
    if (js.typed !== js.heard) {
      js.heard = js.typed;
      js.pending = js.pending.map((p) => ({ ...p, orphaned: true }));
    }
    const write = completionToWrite(js.typed, js.suppress ? "" : suggest(js.typed), shown(), js.pending);
    if (write) {
      js.pending.push(write);
      main.push({ kind: "complete", write });
    }
    const value = js.typed + shown();
    if (value !== js.lastNativeText) {
      js.lastNativeText = value;
      main.push({ kind: "rnCommand", text: value, count: js.mostRecentEventCount });
    }
  };

  const onEvent = ({ text, count }) => {
    const c = fieldChange(js.typed, shown(), text, js.pending);
    if (c.echo) {
      js.pending = js.pending.slice(c.settled);
      if (!c.stale) js.inline = c.inline;
    } else {
      js.inline = null;
      js.heard = c.typed;
      js.typed = c.typed;
      js.suppress = c.suppress;
    }
    js.lastNativeText = text;
    js.mostRecentEventCount = count;
    rendered();
  };
  const onResult = ({ write, result }) => {
    if (result === 2) return;
    js.pending = withoutFirst(js.pending, write);
    // Only a completion already showing re-renders (useInlineCompletion's setInline).
    if (result === 1) {
      js.inline = write;
      rendered();
    }
  };

  const onMain = (op) => {
    switch (op.kind) {
      case "complete": {
        const next = applyInline(field, op.write);
        if (!next) return results.push({ write: op.write, result: 0 });
        if (next.text === field.text) {
          field.selection = next.selection;
          return results.push({ write: op.write, result: 1 });
        }
        change(next.text, next.selection);
        return results.push({ write: op.write, result: 2 });
      }
      // setTextAndSelection: checked against the event count here, then the text is mounted
      // (checked again) and the selection set to (-1, -1), i.e. the end, a hop later, unchecked.
      case "rnCommand":
        if (op.count !== field.count) return;
        main.push({ kind: "rnMount", text: op.text, count: op.count }, { kind: "rnCaretToEnd" });
        return;
      case "rnMount": {
        if (op.count !== field.count || op.text === field.text) return;
        const s = field.selection;
        const caret = s.start === s.end ? op.text.length - (field.text.length - s.start) : Math.min(s.start, op.text.length);
        field.text = op.text;
        field.selection = { start: caret, end: s.start === s.end ? caret : Math.min(s.end, op.text.length) };
        return;
      }
      case "rnCaretToEnd":
        field.selection = { start: field.text.length, end: field.text.length };
        return;
    }
  };

  /** The bar sets its own text (Esc, a scope, a reset). */
  const setText = (text) => {
    js.inline = null;
    js.typed = text;
    js.suppress = true;
    rendered();
  };

  return { field, js, shown, main, events, results, key, setText, onMain, onEvent, onResult, steps: 0 };
}

/**
 * Types `keys` with the given schedule: `pick(n)` returns which of the n runnable steps runs next
 * (the next key, the next field-side op, the next event or promise to reach JS).
 */
function run(keys, pick) {
  const w = world();
  const queue = [...keys];
  for (;;) {
    const runnable = [];
    if (queue.length) runnable.push(() => w.key(queue.shift()));
    if (w.main.length) runnable.push(() => w.onMain(w.main.shift()));
    if (w.events.length) runnable.push(() => w.onEvent(w.events.shift()));
    if (w.results.length) runnable.push(() => w.onResult(w.results.shift()));
    if (!runnable.length) return w;
    if (++w.steps > 500) throw new Error(`no settling after 500 steps: ${JSON.stringify({ field: w.field, js: w.js, main: w.main })}`);
    runnable[pick(runnable.length)]();
  }
}

/** A seeded PRNG (mulberry32), so a failing schedule can be replayed. */
function random(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Once everything has settled: the field shows what was typed, JS agrees, any completion is selected. */
function assertSettled(w, typed, label) {
  const { field, js } = w;
  const completion = w.shown();
  assert.equal(js.typed, typed, `${label}: JS typed`);
  assert.equal(field.text, typed + completion, `${label}: field text`);
  assert.deepEqual(field.selection, { start: typed.length, end: field.text.length }, `${label}: selection`);
  if (!js.suppress) assert.equal(completion, suggest(typed), `${label}: completion`);
}

/** Runs `keys` under every schedule; returns how many there were. */
function everySchedule(keys, check) {
  // Each run takes the first choice past its prefix; the alternatives at each later step are
  // explored from there.
  let schedules = 0;
  const explore = (prefix) => {
    const options = [];
    const w = run(keys, (n) => {
      options.push(n);
      return options.length <= prefix.length ? prefix[options.length - 1] : 0;
    });
    schedules++;
    check(w, prefix.join(""));
    const taken = options.map((_, i) => (i < prefix.length ? prefix[i] : 0));
    for (let j = prefix.length; j < options.length; j++) {
      for (let c = 1; c < options[j]; c++) explore([...taken.slice(0, j), c]);
    }
  };
  explore([]);
  return schedules;
}

test("typing over a completion: m → f → s is 'mfs' in every interleaving", () => {
  const n = everySchedule(["m", "f", "s"], (w, schedule) => assertSettled(w, "mfs", `schedule ${schedule}`));
  assert.ok(n > 50, `${n} schedules`);
});

test("typing along a completion: m → a → i keeps completing, in every interleaving", () => {
  everySchedule(["m", "a", "i"], (w, schedule) => {
    assertSettled(w, "mai", `schedule ${schedule}`);
    assert.equal(w.field.text, "mail.google.com", `schedule ${schedule}`);
  });
});

test("random schedules: what's typed is what the field shows, completion selected after it", () => {
  const words = ["mfs", "mail.google.com/x", "mail.go", "accounts", "ma.x", "x.com/hx", "mmm", "am", "xcom"];
  for (const word of words) {
    for (let seed = 1; seed <= 400; seed++) {
      const r = random(seed);
      const w = run([...word], (n) => Math.floor(r() * n));
      assertSettled(w, word, `${word} seed ${seed}`);
    }
  }
});

test("typed slowly (JS catches up after every key), 'm' completes to the host, selected", () => {
  const w = run(["m"], (n) => n - 1);
  assert.equal(w.field.text, "mail.google.com");
  assert.deepEqual(w.field.selection, { start: 1, end: 15 });
  assert.equal(w.js.typed, "m");
});

test("a completion computed for older text is never applied", () => {
  // "m" reaches JS, which asks for "ail.google.com"; "f" is typed before the field gets the request.
  const w = world();
  w.key("m");
  w.onEvent(w.events.shift());
  assert.deepEqual(w.main.map((op) => op.kind), ["complete"]);
  w.key("f");
  w.onMain(w.main.shift());
  assert.equal(w.field.text, "mf");
  assert.deepEqual(w.results, [{ write: { typed: "m", completion: "ail.google.com" }, result: 0 }]);
  w.onResult(w.results.shift());
  w.onEvent(w.events.shift());
  assert.equal(w.js.typed, "mf");
  assert.deepEqual(w.js.pending, []);
});

/** Runs everything queued, field first. */
function settle(w) {
  while (w.main.length || w.events.length || w.results.length) {
    if (w.main.length) w.onMain(w.main.shift());
    else if (w.events.length) w.onEvent(w.events.shift());
    else w.onResult(w.results.shift());
  }
}

test("⌫ over a completion removes just the completion, and doesn't complete again", () => {
  const w = world();
  for (const k of ["m", "a"]) {
    w.key(k);
    settle(w);
  }
  assert.equal(w.field.text, "mail.google.com");
  w.key("⌫");
  settle(w);
  assert.equal(w.field.text, "ma");
  assert.equal(w.shown(), "");
  assert.equal(w.js.suppress, true);
  w.key("⌫");
  settle(w);
  assert.equal(w.field.text, "m");
  assert.equal(w.shown(), "");
  // Typing again completes again.
  w.key("a");
  settle(w);
  assert.equal(w.field.text, "mail.google.com");
  assert.deepEqual(w.field.selection, { start: 2, end: 15 });
});

test("the bar clearing itself while a completion is on its way stays cleared", () => {
  const w = world();
  w.key("m");
  w.onEvent(w.events.shift());
  w.setText("");
  // The completion lands first (the field still shows "m"); the bar's own write, made for the
  // event count before it, is then dropped by the field, and written again after the echo.
  w.onMain(w.main.shift());
  assert.equal(w.field.text, "mail.google.com");
  settle(w);
  assert.equal(w.field.text, "");
  assert.equal(w.js.typed, "");
  assert.equal(w.shown(), "");
});

test("fieldChange: typing, deleting, echoes", () => {
  assert.deepEqual(fieldChange("m", "ail.google.com", "mf", []), { echo: false, typed: "mf", suppress: false });
  assert.deepEqual(fieldChange("m", "ail.google.com", "m", []), { echo: false, typed: "m", suppress: true });
  assert.deepEqual(fieldChange("ma", "", "m", []), { echo: false, typed: "m", suppress: true });
  const pending = [{ typed: "m", completion: "ail.google.com" }];
  assert.deepEqual(fieldChange("m", "", "mail.google.com", pending), { echo: true, settled: 1, inline: pending[0], stale: false });
  // JS cleared the bar (Esc) while the completion was on its way: the echo is stale.
  assert.equal(fieldChange("", "", "mail.google.com", [{ ...pending[0], orphaned: true }]).stale, true);
  // Every prefix of the host completes to the same text: a key producing it isn't an older echo.
  const older = [{ typed: "mail.googl", completion: "e.com" }];
  assert.deepEqual(fieldChange("mail.google.co", "", "mail.google.com", older), { echo: false, typed: "mail.google.com", suppress: false });
});

test("completionToWrite: only what the field doesn't show or isn't about to", () => {
  assert.equal(completionToWrite("m", "ail.google.com", "ail.google.com", []), null);
  assert.deepEqual(completionToWrite("m", "ail.google.com", "", []), { typed: "m", completion: "ail.google.com" });
  assert.equal(completionToWrite("m", "ail.google.com", "", [{ typed: "m", completion: "ail.google.com" }]), null);
  // Esc while a completion is on its way: take it back.
  assert.deepEqual(completionToWrite("m", "", "", [{ typed: "m", completion: "ail.google.com" }]), { typed: "m", completion: "" });
});
