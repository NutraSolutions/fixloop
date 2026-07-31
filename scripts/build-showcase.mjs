import { copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
await Promise.all([
  copyFile(resolve(root, "public/fixloop.js"), resolve(root, "showcase/fixloop.js")),
  copyFile(resolve(root, "public/fixloop.css"), resolve(root, "showcase/fixloop.css"))
]);
console.log("Showcase assets built");
