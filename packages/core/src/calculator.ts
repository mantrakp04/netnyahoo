/**
 * The command bar's calculator ("Perform mathematical calculations"). A small recursive-descent
 * parser: no `eval`, no variables, nothing but arithmetic, a few functions and unit conversions.
 *
 *   expr    := term (("+" | "-") term)*
 *   term    := unary (("*" | "/" | "mod" | "%" | implicit) unary)*
 *   unary   := ("-" | "+") unary | power
 *   power   := postfix ("^" unary)?          (right-associative, so -2^2 = -4)
 *   postfix := primary ("!" | "%" | "°")*
 *   primary := number | constant | function "(" expr ("," expr)* ")" | "(" expr ")"
 */

type Token = { type: "num"; value: number } | { type: "op"; value: string } | { type: "id"; value: string };

const CONSTANTS: Record<string, number> = { pi: Math.PI, "π": Math.PI, e: Math.E, tau: 2 * Math.PI, "τ": 2 * Math.PI };

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  ln: Math.log,
  log: (x, base) => (base === undefined ? Math.log10(x) : Math.log(x) / Math.log(base)),
  log2: Math.log2,
  log10: Math.log10,
  exp: Math.exp,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
};

const OPERATOR_ALIASES: Record<string, string> = { "×": "*", "·": "*", "÷": "/", "−": "-", "–": "-", "**": "^" };

function tokenize(source: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const rest = source.slice(i);
    const space = /^\s+/.exec(rest);
    if (space) {
      i += space[0].length;
      continue;
    }
    const num = /^(\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i.exec(rest);
    if (num) {
      tokens.push({ type: "num", value: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    const op = /^(\*\*|[-+*/^%!(),×·÷−–°])/.exec(rest);
    if (op) {
      tokens.push({ type: "op", value: OPERATOR_ALIASES[op[0]] ?? op[0] });
      i += op[0].length;
      continue;
    }
    const id = /^([a-z][a-z0-9]*|π|τ)/i.exec(rest);
    if (id) {
      tokens.push({ type: "id", value: id[0].toLowerCase() });
      i += id[0].length;
      continue;
    }
    return null;
  }
  return tokens;
}

class Parser {
  private i = 0;
  private readonly tokens: Token[];
  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parse(): number | null {
    const value = this.expr();
    return this.i === this.tokens.length ? value : null;
  }

  private peek(offset = 0): Token | undefined {
    return this.tokens[this.i + offset];
  }

  private isOp(value: string, offset = 0): boolean {
    const t = this.peek(offset);
    return t?.type === "op" && t.value === value;
  }

  private isId(value: string, offset = 0): boolean {
    const t = this.peek(offset);
    return t?.type === "id" && t.value === value;
  }

  private startsPrimary(offset = 0): boolean {
    const t = this.peek(offset);
    return !!t && (t.type === "num" || (t.type === "id" && (t.value in CONSTANTS || t.value in FUNCTIONS)) || (t.type === "op" && t.value === "("));
  }

  private expr(): number {
    let value = this.term();
    while (this.isOp("+") || this.isOp("-")) {
      const op = (this.tokens[this.i++] as { value: string }).value;
      const rhs = this.term();
      value = op === "+" ? value + rhs : value - rhs;
    }
    return value;
  }

  private term(): number {
    let value = this.unary();
    for (;;) {
      if (this.isOp("*") || this.isOp("/") || this.isId("mod") || this.isId("of") || this.isId("x")) {
        const t = this.tokens[this.i++]!;
        const rhs = this.unary();
        if (t.value === "/") value /= rhs;
        else if (t.value === "mod") value %= rhs;
        else value *= rhs; // "*", "of" (20% of 50), "x" (3 x 4)
      } else if (this.isOp("%") && this.startsPrimary(1)) {
        this.i++;
        value %= this.unary();
      } else if (this.peek()?.type !== "num" && this.startsPrimary()) {
        // Implicit multiplication: 2pi, 3(4+1), (1+2)(3+4). Never between two plain numbers.
        value *= this.unary();
      } else {
        return value;
      }
    }
  }

  private unary(): number {
    if (this.isOp("-")) {
      this.i++;
      return -this.unary();
    }
    if (this.isOp("+")) {
      this.i++;
      return this.unary();
    }
    return this.power();
  }

  private power(): number {
    const base = this.postfix();
    if (this.isOp("^")) {
      this.i++;
      return Math.pow(base, this.unary());
    }
    return base;
  }

  private postfix(): number {
    let value = this.primary();
    for (;;) {
      if (this.isOp("!")) {
        this.i++;
        value = factorial(value);
      } else if (this.isOp("%") && !this.startsPrimary(1)) {
        this.i++;
        value /= 100;
      } else if (this.isOp("°") || this.isId("deg") || this.isId("degrees")) {
        this.i++;
        value *= Math.PI / 180;
      } else {
        return value;
      }
    }
  }

  private primary(): number {
    const t = this.tokens[this.i++];
    if (!t) throw new SyntaxError("unexpected end");
    if (t.type === "num") return t.value;
    if (t.type === "op" && t.value === "(") {
      const value = this.expr();
      this.expect(")");
      return value;
    }
    if (t.type === "id" && t.value in CONSTANTS) return CONSTANTS[t.value]!;
    if (t.type === "id" && t.value in FUNCTIONS) {
      this.expect("(");
      const args = [this.expr()];
      while (this.isOp(",")) {
        this.i++;
        args.push(this.expr());
      }
      this.expect(")");
      return FUNCTIONS[t.value]!(...args);
    }
    throw new SyntaxError(`unexpected ${t.value}`);
  }

  private expect(op: string) {
    if (!this.isOp(op)) throw new SyntaxError(`expected ${op}`);
    this.i++;
  }
}

function factorial(n: number): number {
  if (!Number.isInteger(n) || n < 0 || n > 170) return NaN;
  let out = 1;
  for (let k = 2; k <= n; k++) out *= k;
  return out;
}

/** Evaluates an arithmetic expression; null when it isn't one (or has no finite value). */
export function evaluate(expression: string): number | null {
  // "1,234,567" is a number, unless commas separate function arguments.
  const source = /[a-z]\s*\(/i.test(expression) ? expression : expression.replace(/(\d),(?=\d{3}(?!\d))/g, "$1");
  const tokens = tokenize(source);
  if (!tokens?.length) return null;
  try {
    const value = new Parser(tokens).parse();
    return value !== null && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

/** 12 significant digits, so 0.1 + 0.2 shows as 0.3; exponents for very large/small values. */
export function formatNumber(value: number, digits = 12): string {
  if (value === 0) return "0";
  const rounded = Number(value.toPrecision(digits));
  const abs = Math.abs(rounded);
  if (abs >= 1e21 || abs < 1e-9) return rounded.toExponential().replace(/\.?0+e/, "e");
  return String(rounded);
}

type Unit = { dim: string; factor: number; label: string };

/** Conversion factors to each dimension's base unit (m, kg, l, s, byte, m/s). */
const UNITS: Record<string, Unit> = {};
function units(dim: string, factor: number, label: string, ...names: string[]) {
  for (const name of [label, ...names]) UNITS[name.toLowerCase()] = { dim, factor, label };
}
units("length", 1, "m", "meter", "meters", "metre", "metres");
units("length", 1000, "km", "kilometer", "kilometers", "kilometre", "kilometres");
units("length", 0.01, "cm", "centimeter", "centimeters");
units("length", 0.001, "mm", "millimeter", "millimeters");
units("length", 1609.344, "mi", "mile", "miles");
units("length", 0.9144, "yd", "yard", "yards");
units("length", 0.3048, "ft", "foot", "feet");
units("length", 0.0254, "in", "inch", "inches");
units("length", 1852, "nmi", "nautical mile");
units("mass", 1, "kg", "kilogram", "kilograms", "kilo", "kilos");
units("mass", 0.001, "g", "gram", "grams");
units("mass", 1e-6, "mg", "milligram", "milligrams");
units("mass", 0.45359237, "lb", "lbs", "pound", "pounds");
units("mass", 0.028349523125, "oz", "ounce", "ounces");
units("mass", 6.35029318, "st", "stone", "stones");
units("mass", 1000, "t", "tonne", "tonnes");
units("volume", 1, "l", "liter", "liters", "litre", "litres");
units("volume", 0.001, "ml", "milliliter", "milliliters", "millilitre", "millilitres");
units("volume", 3.785411784, "gal", "gallon", "gallons");
units("volume", 0.946352946, "qt", "quart", "quarts");
units("volume", 0.473176473, "pt", "pint", "pints");
units("volume", 0.2365882365, "cup", "cups");
units("volume", 0.0295735295625, "fl oz", "floz");
units("volume", 0.01478676478125, "tbsp", "tablespoon", "tablespoons");
units("volume", 0.00492892159375, "tsp", "teaspoon", "teaspoons");
units("time", 0.001, "ms", "millisecond", "milliseconds");
units("time", 1, "s", "sec", "secs", "second", "seconds");
units("time", 60, "min", "mins", "minute", "minutes");
units("time", 3600, "h", "hr", "hrs", "hour", "hours");
units("time", 86400, "days", "day", "d");
units("time", 604800, "weeks", "week", "wk");
units("time", 31556952, "years", "year", "yr");
units("data", 0.125, "bits", "bit");
units("data", 1, "bytes", "byte", "B");
units("data", 1e3, "KB", "kilobyte", "kilobytes");
units("data", 1e6, "MB", "megabyte", "megabytes");
units("data", 1e9, "GB", "gigabyte", "gigabytes");
units("data", 1e12, "TB", "terabyte", "terabytes");
units("data", 1024, "KiB");
units("data", 1024 ** 2, "MiB");
units("data", 1024 ** 3, "GiB");
units("data", 1024 ** 4, "TiB");
units("speed", 1, "m/s");
units("speed", 1000 / 3600, "km/h", "kph", "kmh");
units("speed", 1609.344 / 3600, "mph");
units("speed", 1852 / 3600, "knots", "knot", "kn");

const TEMPERATURES: Record<string, "C" | "F" | "K"> = {
  c: "C", "°c": "C", celsius: "C", f: "F", "°f": "F", fahrenheit: "F", k: "K", kelvin: "K",
};
const toCelsius = { C: (v: number) => v, F: (v: number) => ((v - 32) * 5) / 9, K: (v: number) => v - 273.15 };
const fromCelsius = { C: (v: number) => v, F: (v: number) => (v * 9) / 5 + 32, K: (v: number) => v + 273.15 };

const unitPattern = [...Object.keys(UNITS), ...Object.keys(TEMPERATURES)]
  .sort((a, b) => b.length - a.length)
  .map((u) => u.replace(/[/.]/g, "\\$&").replace(/ /g, "\\s*"))
  .join("|");
const CONVERSION = new RegExp(`^(.+?)\\s*(${unitPattern})\\s+(?:to|in|into|as|=|->|→)\\s+(${unitPattern})$`, "i");

function convert(input: string): { value: number; unit: string } | null {
  const m = CONVERSION.exec(input);
  if (!m) return null;
  const amount = evaluate(m[1]!);
  if (amount === null) return null;
  const from = m[2]!.toLowerCase().replace(/\s+/g, " ");
  const to = m[3]!.toLowerCase().replace(/\s+/g, " ");
  const tFrom = TEMPERATURES[from];
  const tTo = TEMPERATURES[to];
  if (tFrom && tTo) return { value: fromCelsius[tTo](toCelsius[tFrom](amount)), unit: `°${tTo}`.replace("°K", "K") };
  const a = UNITS[from];
  const b = UNITS[to];
  if (!a || !b || a.dim !== b.dim) return null;
  return { value: (amount * a.factor) / b.factor, unit: b.label };
}

export type Calculation = { expression: string; value: number; display: string };

/**
 * A calculator answer for command-bar input, or null when the input isn't a calculation:
 * plain numbers, dates, IP addresses and lone constants ("e") stay searches.
 */
export function calculate(raw: string): Calculation | null {
  const expression = raw.trim().replace(/^=\s*/, "").replace(/\s*=\s*\??$/, "");
  if (!expression || expression.length > 200 || !/[\dπτ]|\b(pi|e|tau)\b/i.test(expression)) return null;
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(expression) || /^\d+(\.\d+){2,}$/.test(expression)) return null;

  const converted = convert(expression);
  if (converted) {
    const display = `${formatNumber(converted.value, 9)} ${converted.unit}`;
    return { expression, value: converted.value, display };
  }
  // Something has to be computed: an operator between operands, a function, or a postfix op.
  const hasOperator = /[\w).πτ]\s*(\*\*|[-+*/^%×·÷−–]|mod|of|x)\s*[\d(.a-zπτ]/i.test(expression) || /[!%°]\s*$/.test(expression);
  const hasFunction = new RegExp(`\\b(${Object.keys(FUNCTIONS).join("|")})\\s*\\(`, "i").test(expression);
  if (!hasOperator && !hasFunction) return null;
  const value = evaluate(expression);
  if (value === null) return null;
  return { expression, value, display: formatNumber(value) };
}
