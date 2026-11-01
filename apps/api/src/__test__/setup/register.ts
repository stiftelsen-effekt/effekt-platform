/**
 * Runs in every test worker before the spec (see vitest.config.ts): loads the test environment
 * and lets Node `require` TypeScript, as `mocha --require dotenv/config --require ts-node/register`
 * did.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
require("dotenv").config({ path: process.env.DOTENV_CONFIG_PATH ?? ".env.test", quiet: true });
// ts-node loads the TypeScript compiler through v8-compile-cache-lib, which keeps one V8 code cache
// file per machine (in os.tmpdir()) and rewrites it, unlocked for readers, as each process exits.
// With a fork per spec file, a worker can read the cache while another rewrites it and hand V8
// a torn cache, which V8 does not checksum: the worker then dies with "Check failed: current ==
// end_slot_index" or "ReadSingleBytecodeData(...) == 1" (SIGTRAP). Without the cache, loading
// TypeScript costs each worker about 35 ms more.
process.env.DISABLE_V8_COMPILE_CACHE = "1";
// eslint-disable-next-line @typescript-eslint/no-require-imports
require("ts-node").register({ transpileOnly: true });
