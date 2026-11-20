// Runs pnpm with the environment of this Node process, for package scripts that need the
// variables from an env file in a command that isn't Node itself (the Sanity CLI):
//
//   node --env-file-if-exists=.env.local scripts/pnpm-with-env.mjs --dir studio start
//
// Node loads the file (variables already set in the environment win), and pnpm and what it runs
// inherit them. Replaces `dotenv run -f .env.local -- pnpm ...`.
//
// The pnpm that started this script (npm_execpath) is run directly, without a shell, so this
// also works on Windows, where spawning pnpm.cmd would need one.
import { spawnSync } from "node:child_process";

const pnpm = process.env.npm_execpath;
if (!pnpm) {
  console.error("Run this from a pnpm script (npm_execpath is not set).");
  process.exit(2);
}
const args = process.argv.slice(2);
// pnpm is a JavaScript file when installed through Corepack or npm, an executable when standalone
const [file, fileArgs] = /\.[cm]?js$/.test(pnpm)
  ? [process.execPath, [pnpm, ...args]]
  : [pnpm, args];
const result = spawnSync(file, fileArgs, { stdio: "inherit" });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
