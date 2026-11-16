// MapLibre 6 finds its worker relative to its own module URL, which breaks once
// Next.js bundles it. Serve the (self-contained) worker from /public instead,
// named by version so browsers pick up upgrades. Runs before dev and build.
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve("maplibre-gl/package.json"));
const { version } = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
const outDir = new URL("../public/maplibre/", import.meta.url);

mkdirSync(outDir, { recursive: true });
for (const f of readdirSync(outDir)) rmSync(new URL(f, outDir));
copyFileSync(join(pkgDir, "dist/maplibre-gl-worker.mjs"), new URL(`maplibre-gl-worker-${version}.mjs`, outDir));
console.log(`maplibre worker ${version} copied to public/maplibre/`);
