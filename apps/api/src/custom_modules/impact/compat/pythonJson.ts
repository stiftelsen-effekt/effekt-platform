/**
 * JSON written byte for byte as the legacy impact API wrote it (Django's JsonResponse, i.e.
 * Python's json.dumps with its defaults): `", "` and `": "` separators, every character outside
 * printable ASCII escaped as \uXXXX, and floats in Python's repr (`1.0`, `1e-05`, `1e+16`).
 *
 * JavaScript has one number type, so values that Python sent as floats (the converted amounts)
 * are wrapped in PyFloat; plain numbers are written as integers.
 */

export class PyFloat {
  constructor(readonly value: number) {}
}

export const pyFloat = (value: number) => new PyFloat(value);

export type PyJson =
  null | boolean | number | string | PyFloat | PyJson[] | { [key: string]: PyJson | undefined };

/** Python's repr() of a float */
export function pythonFloatRepr(x: number): string {
  if (Number.isNaN(x)) return "NaN";
  if (x === Infinity) return "Infinity";
  if (x === -Infinity) return "-Infinity";
  if (x === 0) return Object.is(x, -0) ? "-0.0" : "0.0";
  // toExponential() without an argument gives the shortest digits that round-trip, as repr does
  const [mantissa, exp] = x.toExponential().split("e");
  const e = Number(exp);
  const negative = mantissa.startsWith("-");
  const digits = mantissa.replace("-", "").replace(".", "");
  const sign = negative ? "-" : "";
  // Python switches to exponent notation below 1e-4 and from 1e16
  if (e >= -4 && e < 16) {
    if (e < 0) return sign + "0." + "0".repeat(-e - 1) + digits;
    const intPart = digits.slice(0, e + 1).padEnd(e + 1, "0");
    const frac = digits.slice(e + 1);
    return sign + intPart + "." + (frac || "0");
  }
  const m = digits[0] + (digits.length > 1 ? "." + digits.slice(1) : "");
  const expSign = e < 0 ? "-" : "+";
  return sign + m + "e" + expSign + String(Math.abs(e)).padStart(2, "0");
}

const ESCAPES: Record<string, string> = {
  '"': '\\"',
  "\\": "\\\\",
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
  "\b": "\\b",
  "\f": "\\f",
};

/** A string as json.dumps(ensure_ascii=True) writes it */
export function pythonString(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const code = s.charCodeAt(i);
    if (ESCAPES[ch]) out += ESCAPES[ch];
    else if (code < 0x20 || code > 0x7e) out += "\\u" + code.toString(16).padStart(4, "0");
    else out += ch;
  }
  return out + '"';
}

export function pythonJson(value: PyJson): string {
  if (value === null) return "null";
  if (value === true) return "true";
  if (value === false) return "false";
  if (value instanceof PyFloat) return pythonFloatRepr(value.value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error(`Not an integer: ${value}`);
    return String(value);
  }
  if (typeof value === "string") return pythonString(value);
  if (Array.isArray(value)) return "[" + value.map(pythonJson).join(", ") + "]";
  const parts: string[] = [];
  for (const [key, v] of Object.entries(value)) {
    if (v === undefined) continue;
    parts.push(pythonString(key) + ": " + pythonJson(v));
  }
  return "{" + parts.join(", ") + "}";
}
