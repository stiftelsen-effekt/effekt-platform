// Runs a command with the environment of this Node process, for npm scripts that need the
// variables from an env file in a command that isn't Node itself (pnpm, sanity):
//
//   node --env-file-if-exists=.env.local scripts/with-env.mjs pnpm --dir studio start
//
// Node loads the file (variables already set in the environment win), and the command inherits
// them. Replaces `dotenv run -f .env.local -- <command>`.
import { spawnSync } from "node:child_process";

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("Usage: node --env-file-if-exists=<file> scripts/with-env.mjs <command> [args...]");
  process.exit(2);
}
// Windows needs a shell to find pnpm.cmd and the other .cmd shims
const result = spawnSync(command, args, { stdio: "inherit", shell: process.platform === "win32" });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
