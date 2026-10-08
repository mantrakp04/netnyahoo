// 0.1.6: typing quickly while the address bar filled in a suggestion could drop or reorder letters. These run
// the field, the JS side and the completion protocol under every interleaving of their messages.
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSuggestions } from "@netnyahoo/core";
import { acceptsCompletion, completionToWrite, fieldChange, withoutFirst } from "./inline.ts";

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

function applyInline({ text, selection }, inline) {
  const n = inline.typed.length;
  if (!text.startsWith(inline.typed) || selection.start !== n || selection.end !== text.length) return null;
  const next = inline.typed + inline.completion;
  return { text: next, selection: { start: n, end: next.length } };
}

function world() {
  const field = { text: "", selection: { start: 0, end: 0 }, count: 0 };
  const main = [];
  const events = [];
  const results = [];
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

  return { field, js, shown, main, events, results, key, onMain, onEvent, onResult, steps: 0 };
}

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

function random(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function assertSettled(w, typed, label) {
  const { field, js } = w;
  const completion = w.shown();
  assert.equal(js.typed, typed, `${label}: JS typed`);
  assert.equal(field.text, typed + completion, `${label}: field text`);
  assert.deepEqual(field.selection, { start: typed.length, end: field.text.length }, `${label}: selection`);
  if (!js.suppress) assert.equal(completion, suggest(typed), `${label}: completion`);
}

function everySchedule(keys, check) {
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

test("a completion computed for older text is never applied", () => {
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

test("fieldChange: any deletion drops the completion; typing brings it back", () => {
  const sup = (typed, shown, next) => fieldChange(typed, shown, next, []).suppress;
  // Backspace over the selected completion, Delete, cut of the selection.
  assert.equal(sup("gi", "thub.com", "gi"), true);
  // Further backspaces, ⌥⌫ / ⌘⌫ (whole word or everything), with no completion showing.
  assert.equal(sup("gi", "", "g"), true);
  assert.equal(sup("github", "", ""), true);
  // Deleting or cutting from the middle or the start.
  assert.equal(sup("github", "", "gihub"), true);
  assert.equal(sup("github", "", "hub"), true);
  assert.equal(sup("gi", "thub.com", "thub.com"), true);
  // Typing, including over the selected completion (the field is shorter than before but text went in).
  assert.equal(sup("gi", "thub.com", "git"), false);
  assert.equal(sup("gi", "thub.com", "gix"), false);
  assert.equal(sup("gi", "", "git"), false);
  assert.equal(sup("", "", "g"), false);
  // Selecting part of the text and typing a different letter replaces it: not a deletion.
  assert.equal(sup("github", "", "gx"), false);
  assert.equal(sup("github", "", "xthub"), false);
});

// Chrome's rules need the selection the edit replaced and the caret it left (RN reports the caret first).
const sel = (start, end = start) => ({ start, end });
const edit = (typed, shown, next, before, after) => fieldChange(typed, shown, next, [], { before, after }).suppress;

test("fieldChange with the field's selection: a replaced selection is typing, a removal is a deletion", () => {
  // gi + ⌘A, then "g": the whole text was replaced, nothing was deleted.
  assert.equal(edit("gi", "", "g", sel(0, 2), sel(1)), false);
  assert.equal(edit("gi", "thub.com", "g", sel(0, 10), sel(1)), false);
  // ⌫ at the end of "gi" gives the same text but a caret left of the old selection start.
  assert.equal(edit("gi", "", "g", sel(2), sel(1)), true);
  // ⌫ over the selected completion, ⌦ at the caret, ⌫ in the middle, cutting a selection.
  assert.equal(edit("gi", "thub.com", "gi", sel(2, 10), sel(2)), true);
  assert.equal(edit("github", "", "gihub", sel(2), sel(2)), true);
  assert.equal(edit("github", "", "gihub", sel(3), sel(2)), true);
  assert.equal(edit("github", "", "ghub", sel(1, 3), sel(1)), true);
  // ⌦ leaves the caret where it was and reports no selection: the bar passes that caret as both.
  assert.equal(edit("gi", "", "g", sel(1), sel(1)), true);
  // Typing, also over the selected completion (the field is shorter than before, with text put in).
  assert.equal(edit("gi", "thub.com", "git", sel(2, 10), sel(3)), false);
  assert.equal(edit("gi", "", "git", sel(2), sel(3)), false);
  assert.equal(edit("", "", "g", sel(0), sel(1)), false);
  // A longer replacement is a paste, over a selection or not.
  assert.equal(edit("", "", "git", sel(0), sel(3)), true);
  assert.equal(edit("gi", "thub.com", "gitlab", sel(2, 10), sel(6)), true);
  assert.equal(edit("github", "", "gixyzthub", sel(2), sel(5)), true);
  assert.equal(edit("gi", "", "g😀", sel(1, 2), sel(3)), false);
  // A selection that doesn't explain the edit (stale) falls back to the text.
  assert.equal(edit("gi", "", "git", sel(0), sel(3)), false);
  assert.equal(edit("", "", "github", sel(9), sel(6)), true);
});

test("fieldChange without a selection: pasting more than a character blocks the completion", () => {
  const sup = (typed, shown, next) => fieldChange(typed, shown, next, []).suppress;
  assert.equal(sup("", "", "github"), true);
  assert.equal(sup("gi", "", "gitlab"), true);
  assert.equal(sup("gi", "thub.com", "git"), false);
  assert.equal(sup("", "", "g"), false);
});

test("the caret reaching the end of the text with the completion accepts it", () => {
  assert.equal(acceptsCompletion("git", "hub.com", sel(10), []), true);
  // Still selected, left of the end, caret at the start of the completion (Backspace, Delete), or no completion.
  assert.equal(acceptsCompletion("git", "hub.com", sel(3, 10), []), false);
  assert.equal(acceptsCompletion("git", "hub.com", sel(3), []), false);
  assert.equal(acceptsCompletion("git", "", sel(3), []), false);
  // A write in flight passes its own selection changes through here.
  assert.equal(acceptsCompletion("git", "hub.com", sel(10), [{ typed: "git", completion: "hub.com" }]), false);
  // After accepting, typed is "github.com": ⌫ there is a plain deletion.
  assert.equal(edit("github.com", "", "github.co", sel(10), sel(9)), true);
});
