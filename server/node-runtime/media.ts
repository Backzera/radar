/** R2-compatible photo storage on the local disk, for self-hosting. */
import { createReadStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import type { MediaStore } from "../inventory";

export function createFileMedia(root: string): MediaStore {
  const base = resolve(root);
  // Keys come from the app (brick/<user>/<item>/<photo>.<ext>), but a path must
  // never leave the media folder even if a key were tampered with.
  const pathOf = (key: string) => {
    const path = resolve(base, key);
    if (!path.startsWith(base + sep)) throw new Error("Chave de mídia inválida");
    return path;
  };
  return {
    async put(key, value) {
      const path = pathOf(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, new Uint8Array(value));
    },
    async get(key) {
      const path = pathOf(key);
      try {
        if (!(await stat(path)).isFile()) return null;
      } catch {
        return null;
      }
      return { body: Readable.toWeb(createReadStream(path)) as ReadableStream };
    },
    async delete(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys])
        await rm(pathOf(key), { force: true });
    },
  };
}
