// Copies the files the compiled server serves from disk into dist/, keeping their layout under
// src/: the files directly in src/static/ (not its subdirectories) and everything under
// src/views/. Dotfiles are skipped, as the glob-based copyfiles this replaces did.
import { cpSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const src = join(root, "src");
const dist = join(root, "dist");
const notDotfile = (path) => !basename(path).startsWith(".");

for (const entry of readdirSync(join(src, "static"), { withFileTypes: true })) {
  if (entry.isFile() && notDotfile(entry.name)) {
    cpSync(join(src, "static", entry.name), join(dist, "static", entry.name));
  }
}
cpSync(join(src, "views"), join(dist, "views"), { recursive: true, filter: notDotfile });
