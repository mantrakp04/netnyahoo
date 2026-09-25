import assert from "node:assert/strict";
import { test } from "node:test";
import { calculate, evaluate, formatNumber } from "./calculator.ts";

const calc = (s: string) => calculate(s)?.display ?? null;

test("arithmetic with precedence, associativity and unary minus", () => {
  assert.equal(evaluate("1 + 2 * 3"), 7);
  assert.equal(evaluate("(1 + 2) * 3"), 9);
  assert.equal(evaluate("2 ^ 3 ^ 2"), 512);
  assert.equal(evaluate("-2^2"), -4);
  assert.equal(evaluate("2^-1"), 0.5);
  assert.equal(evaluate("10 - 4 - 3"), 3);
  assert.equal(evaluate("8 / 4 / 2"), 1);
  assert.equal(evaluate("--3"), 3);
});

test("symbols people type: × ÷ − ** and thousands separators", () => {
  assert.equal(evaluate("6 × 7"), 42);
  assert.equal(evaluate("84 ÷ 2"), 42);
  assert.equal(evaluate("50 − 8"), 42);
  assert.equal(evaluate("2**5"), 32);
  assert.equal(evaluate("1,000 * 3"), 3000);
  assert.equal(evaluate("3 x 4"), 12);
});

test("functions, constants, implicit multiplication, postfix operators", () => {
  assert.equal(evaluate("sqrt(16) + abs(-2)"), 6);
  assert.equal(evaluate("max(1, 5, 3)"), 5);
  assert.equal(evaluate("log(1000)"), 3);
  assert.equal(evaluate("log(8, 2)"), 3);
  assert.equal(evaluate("2pi"), 2 * Math.PI);
  assert.equal(evaluate("3(4+1)"), 15);
  assert.equal(evaluate("(1+2)(3+4)"), 21);
  assert.equal(evaluate("5!"), 120);
  assert.equal(evaluate("50%"), 0.5);
  assert.equal(evaluate("20% of 50"), 10);
  assert.equal(evaluate("10 % 3"), 1);
  assert.equal(evaluate("17 mod 5"), 2);
  assert.ok(Math.abs(evaluate("sin(30°)")! - 0.5) < 1e-12);
});

test("rejects anything that isn't arithmetic (no eval, no variables)", () => {
  for (const s of ["", "2 3", "1 +", "foo(1)", "alert(1)", "constructor", "2x", "1/0", "(1", "0x1F", "sqrt 4", "3.5!"]) {
    assert.equal(evaluate(s), null, s);
  }
});

test("calculate only answers things that are calculations", () => {
  assert.equal(calc("2+2"), "4");
  assert.equal(calc("0.1 + 0.2"), "0.3");
  assert.equal(calc("= 6*7 ="), "42");
  assert.equal(calc("2^100"), "1.26765060023e+30");
  assert.equal(calc("sqrt(2)"), "1.41421356237");
  for (const s of ["42", "-5", "e", "pi", "react", "e-mail", "covid-19", "2024-05-01", "192.168.1.1", "1.2.3", "x-men", "iphone 15"]) {
    assert.equal(calc(s), null, s);
  }
});

test("unit conversions (optional extra)", () => {
  assert.equal(calc("5 km to mi"), "3.10685596 mi");
  assert.equal(calc("100 f in c"), "37.7777778 °C");
  assert.equal(calc("0 c to k"), "273.15 K");
  assert.equal(calc("2 * 3 lb to kg"), "2.72155422 kg");
  assert.equal(calc("1 GB to MB"), "1000 MB");
  assert.equal(calc("90 min to h"), "1.5 h");
  assert.equal(calc("5 kg to km"), null); // different dimensions
});

test("formatNumber", () => {
  assert.equal(formatNumber(1 / 3), "0.333333333333");
  assert.equal(formatNumber(1e-12), "1e-12");
  assert.equal(formatNumber(-0.5), "-0.5");
});
