/**
 * Runs in every test worker before the spec (see vitest.config.ts): loads the test environment
 * and lets Node `require` the application's TypeScript (and its ES-syntax .js files), as
 * `mocha --require dotenv/config --require ts-node/register` did.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

// As dotenv did: a missing file is fine, and variables already set in the environment win
const envFile = process.env.DOTENV_CONFIG_PATH ?? ".env.test";
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

// Compile each file to CommonJS with TypeScript's own emit, as ts-node's transpile-only mode did
// and as `tsc` does for production. Not tsx: esbuild exports through getters that cannot be
// redefined, so the specs could no longer stub module exports (`sinon.stub(module, "fn")`).
const apiRoot = path.resolve(__dirname, "../../..");
const tsconfig = ts.getParsedCommandLineOfConfigFile(
  path.join(apiRoot, "tsconfig.json"),
  {},
  { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined },
);
const compilerOptions = {
  ...tsconfig?.options,
  module: ts.ModuleKind.CommonJS,
  sourceMap: false,
  inlineSourceMap: true,
  inlineSources: true,
};
process.setSourceMapsEnabled(true);

// Module#_compile is what Node's own loaders call; @types/node doesn't declare it
type CompilableModule = NodeJS.Module & { _compile(code: string, filename: string): void };
const compile = (module: NodeJS.Module, filename: string) => {
  const source = fs.readFileSync(filename, "utf8");
  const { outputText } = ts.transpileModule(source, { fileName: filename, compilerOptions });
  (module as CompilableModule)._compile(outputText, filename);
};
const nodeJs = require.extensions[".js"];
require.extensions[".ts"] = compile;
require.extensions[".js"] = (module, filename) => {
  const ours =
    filename.startsWith(apiRoot + path.sep) &&
    !filename.includes(`${path.sep}node_modules${path.sep}`);
  return ours ? compile(module, filename) : nodeJs(module, filename);
};
