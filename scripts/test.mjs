import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readdirSync, rmSync } from "node:fs";
// Start clean: a compiled test whose source was deleted must not keep running.
rmSync(".test-build", { recursive: true, force: true });
mkdirSync(".test-build", { recursive: true });
writeFileSync(".test-build/package.json", JSON.stringify({ type: "commonjs" }));
const compile = spawnSync(
  process.execPath,
  ["node_modules/typescript/bin/tsc", "-p", "tests/tsconfig.json"],
  { stdio: "inherit" },
);
if (compile.status !== 0) process.exit(compile.status ?? 1);
const files = readdirSync(".test-build/tests")
  .filter((f) => f.endsWith(".test.js"))
  .map((f) => `.test-build/tests/${f}`);
files.push(
  ...readdirSync("tests")
    .filter((f) => f.endsWith(".test.mjs"))
    .map((f) => `tests/${f}`),
);
const result = spawnSync(process.execPath, ["--test", ...files], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
