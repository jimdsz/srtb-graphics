import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { zipSync } from "fflate";
const root = path.resolve("dist");
const files = {};
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink())
      throw new Error("Symlink not allowed in deployment archive");
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) await collect(filename);
    else
      files[path.relative(root, filename).split(path.sep).join("/")] =
        await readFile(filename);
  }
}
await collect(root);
if (Object.keys(files).some(name => name.startsWith('library/')))
  throw new Error('Refus : la bibliothèque privée ne doit pas être publiée dans l’ancien déploiement statique. Utiliser le studio protégé.');
if (!files["index.html"])
  throw new Error("Build first: dist/index.html is missing");
if (files["_worker.js"]) throw new Error("This project must remain static");
await writeFile("SRTB-Graphics-Cloudflare-Pages.zip", zipSync(files));
console.log(
  `Static deployment archive: ${Object.keys(files).length} files, no user media or server.`,
);
