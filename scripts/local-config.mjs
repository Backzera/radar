import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { randomBytes } from "node:crypto";
export function readLocalConfig(root, environment = {}) {
  let config = {};
  for (const name of [".env", ".dev.vars"]) {
    const file = join(root, name);
    if (existsSync(file))
      config = { ...config, ...parseEnv(readFileSync(file, "utf8")) };
  }
  return {
    ...config,
    ...Object.fromEntries(
      Object.entries(environment).filter(([, v]) => v !== undefined),
    ),
  };
}
export function initializeLocal(root) {
  const file = join(root, ".dev.vars");
  const created = !existsSync(file);
  const example = readFileSync(join(root, ".env.example"), "utf8");
  let content = created ? example : readFileSync(file, "utf8");
  const current = parseEnv(content);
  const missing = Object.entries(parseEnv(example)).filter(
    ([key]) => !(key in current),
  );
  if (missing.length)
    content +=
      "\n# Opções locais adicionadas\n" +
      missing.map(([k, v]) => `${k}=${v}`).join("\n") +
      "\n";
  let tokenGenerated = false;
  if (!parseEnv(content).WORKER_TOKEN?.trim()) {
    const token = randomBytes(32).toString("hex");
    content = content.replace(
      /^[\t ]*(?:export[\t ]+)?WORKER_TOKEN[\t ]*=.*$/gm,
      () => `WORKER_TOKEN=${token}`,
    );
    tokenGenerated = true;
  }
  if (created || missing.length || tokenGenerated)
    writeFileSync(file, content, { mode: 0o600 });
  return { created, added: missing.length, tokenGenerated };
}
