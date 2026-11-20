import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { parseEnv } from "util";

/**
 * Pins how Node's built-in env file loader (process.loadEnvFile, util.parseEnv) reads the API's
 * .env files (server.ts, the test setup, prisma.config.ts), so a Node upgrade can't change the
 * values the API starts with or add output to its logs. It replaced dotenv, and parses
 * everything below as dotenv did; the two differences found are pinned at the end.
 */
const ENV_FILE = [
  "# comment",
  "PLAIN=value",
  "SPACED = spaced value  ",
  'DOUBLE="double # not a comment"',
  "SINGLE='single $NOT_EXPANDED'",
  "INLINE=inline # comment",
  "EMPTY=",
  'MULTI="line one\\nline two"',
  'REAL_MULTI="real line one',
  'real line two"',
  "export EXPORTED=yes",
  "URL=mysql://user:p%40ss@127.0.0.1:3307/db?x=1&y=2",
  'JSON={"a":1}',
  "DUPLICATE=first",
  "DUPLICATE=last",
  "ENV_FILE_CHARACTERIZATION_EXISTING=from-file",
  "ENV_FILE_CHARACTERIZATION_EXISTING_EMPTY=from-file",
  "",
].join("\n");

const KEYS = Object.keys(parseEnv(ENV_FILE));

describe("env file characterization", () => {
  afterEach(() => vi.restoreAllMocks());

  it("parses the .env syntax the API uses", () => {
    expect(parseEnv(ENV_FILE)).toEqual({
      PLAIN: "value",
      SPACED: "spaced value",
      DOUBLE: "double # not a comment",
      SINGLE: "single $NOT_EXPANDED",
      INLINE: "inline",
      EMPTY: "",
      MULTI: "line one\nline two",
      REAL_MULTI: "real line one\nreal line two",
      EXPORTED: "yes",
      URL: "mysql://user:p%40ss@127.0.0.1:3307/db?x=1&y=2",
      JSON: '{"a":1}',
      DUPLICATE: "last",
      ENV_FILE_CHARACTERIZATION_EXISTING: "from-file",
      ENV_FILE_CHARACTERIZATION_EXISTING_EMPTY: "from-file",
    });
  });

  it("loads a file without overriding set variables, even empty ones, or writing output", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "env-file-"));
    const file = path.join(dir, ".env");
    fs.writeFileSync(file, ENV_FILE);
    const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
    const outputs = [
      vi.spyOn(console, "log"),
      vi.spyOn(console, "info"),
      vi.spyOn(console, "warn"),
      vi.spyOn(console, "error"),
      vi.spyOn(process.stdout, "write"),
      vi.spyOn(process.stderr, "write"),
    ];
    try {
      for (const key of KEYS) delete process.env[key];
      process.env.ENV_FILE_CHARACTERIZATION_EXISTING = "from-env";
      // .env.docker relies on this: a variable set to "" must not be filled in from a stray .env
      process.env.ENV_FILE_CHARACTERIZATION_EXISTING_EMPTY = "";

      process.loadEnvFile(file);

      expect(process.env.PLAIN).toBe("value");
      expect(process.env.MULTI).toBe("line one\nline two");
      expect(process.env.ENV_FILE_CHARACTERIZATION_EXISTING).toBe("from-env");
      expect(process.env.ENV_FILE_CHARACTERIZATION_EXISTING_EMPTY).toBe("");
      for (const output of outputs) expect(output).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
      for (const key of KEYS) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws ENOENT for a missing file, so callers check that it exists first", () => {
    expect(() => process.loadEnvFile("/nonexistent/.env")).toThrow(
      expect.objectContaining({ code: "ENOENT" }),
    );
  });

  // Where Node's parser differs from dotenv's. Neither form is in any of the repository's env
  // files; quote values that contain these characters differently.
  it("ends a quoted value at the next matching quote, unlike dotenv", () => {
    // dotenv: "it''s"
    expect(parseEnv("VALUE='it''s'")).toEqual({ VALUE: "it" });
    // dotenv: 'a\\"b' (backslash kept, quote kept)
    expect(parseEnv('VALUE="a\\"b"')).toEqual({ VALUE: "a\\" });
  });
});
