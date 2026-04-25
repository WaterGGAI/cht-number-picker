import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(currentFile), "..");
const publicDir = path.join(rootDir, "public");
const workerEntryPath = path.join(publicDir, "_worker.js");

const wrapper = 'export { default } from "../worker.js";\n';

await mkdir(publicDir, { recursive: true });
await writeFile(workerEntryPath, wrapper, "utf8");
