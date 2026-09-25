import assert from "node:assert/strict";
import { test } from "node:test";
import { chooseTextFragment, textDirective, withTextFragment } from "./textFragment.ts";

const page = `The quick brown fox jumps over the lazy dog.
A second paragraph about foxes and dogs, with a comma-separated list.
The quick brown fox returns in the third paragraph, quick as ever.`;

test("a short, unique selection links to itself", () => {
  const fragment = chooseTextFragment({ selected: "lazy   dog", before: "The quick brown fox jumps over the ", after: ".", pageText: page });
  assert.deepEqual(fragment, { start: "lazy dog" });
});

test("an ambiguous selection gets words of context until it's unique", () => {
  const fragment = chooseTextFragment({
    selected: "quick brown fox",
    before: "The ",
    after: " returns in the third paragraph, quick as ever.",
    pageText: page,
  });
  assert.deepEqual(fragment, { prefix: "The", start: "quick brown fox", suffix: "returns" });
});

test("matching is case-insensitive when checking ambiguity", () => {
  const fragment = chooseTextFragment({ selected: "the", before: "jumps over ", after: " lazy dog.", pageText: page });
  assert.deepEqual(fragment, { prefix: "over", start: "the", suffix: "lazy" });
});

test("selections across blocks or longer than ten words link to their ends", () => {
  assert.deepEqual(
    chooseTextFragment({ selected: "lazy dog.\nA second paragraph about foxes", before: "The quick brown fox jumps over the ", after: " and dogs", pageText: page }),
    { start: "lazy dog.", end: "about foxes" },
  );
  assert.deepEqual(
    chooseTextFragment({
      selected: "A second paragraph about foxes and dogs, with a comma-separated list.",
      before: "",
      after: "",
      pageText: page,
    }),
    { start: "A second paragraph", end: "a comma-separated list." },
  );
});

test("a range start that isn't unique grows before falling back to a prefix", () => {
  const fragment = chooseTextFragment({
    selected: "The quick brown fox returns in the third paragraph, quick as ever.",
    before: "",
    after: "",
    pageText: page,
  });
  assert.deepEqual(fragment, { start: "The quick brown fox returns", end: "third paragraph, quick as ever." });
});

test("a selection inside words grows to whole words", () => {
  assert.deepEqual(chooseTextFragment({ selected: "azy do", before: "The quick brown fox jumps over the l", after: "g.", pageText: page }), {
    start: "lazy dog",
  });
  assert.deepEqual(chooseTextFragment({ selected: "uick brown fox", before: "The q", after: " jumps over", pageText: page }), {
    prefix: "The",
    start: "quick brown fox",
    suffix: "jumps",
  });
});

test("whitespace-only selections have no link", () => {
  assert.equal(chooseTextFragment({ selected: " \n ", before: "", after: "", pageText: page }), null);
});

test("directive terms are percent-encoded, including - , and &", () => {
  assert.equal(textDirective({ start: "a-b, c & d" }), "text=a%2Db%2C%20c%20%26%20d");
  assert.equal(textDirective({ prefix: "over", start: "the", end: "dog", suffix: "end" }), "text=over-,the,dog,-end");
});

test("the page's own fragment is kept and an older directive replaced", () => {
  assert.equal(withTextFragment("https://example.com/a?q=1", { start: "hi" }), "https://example.com/a?q=1#:~:text=hi");
  assert.equal(withTextFragment("https://example.com/a#intro", { start: "hi" }), "https://example.com/a#intro:~:text=hi");
  assert.equal(withTextFragment("https://example.com/a#intro:~:text=old", { start: "hi" }), "https://example.com/a#intro:~:text=hi");
});
