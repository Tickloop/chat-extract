// MARK: Package
// Builds the Chrome Web Store upload from an allowlist rather than zipping the folder, so tests,
// fixtures, icon sources and tooling can never ship by accident.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SHIPPED = ["manifest.json", "popup", "src"];
const SHIPPED_ICONS = /^icons\/icon-\d+\.png$/;
const JUNK = /(^|\/)(\.DS_Store|Thumbs\.db)$/;

// MARK: Collect

function walk(path) {
  const full = join(ROOT, path);
  if (!statSync(full).isDirectory()) return [path];
  return readdirSync(full).flatMap((name) => walk(join(path, name)));
}

const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
const icons = readdirSync(join(ROOT, "icons"))
  .map((name) => `icons/${name}`)
  .filter((p) => SHIPPED_ICONS.test(p));
const files = [...SHIPPED.flatMap(walk), ...icons].filter((p) => !JUNK.test(p)).sort();

// MARK: Validate
// A manifest that points at a file missing from the zip is rejected at upload, so fail here instead.

const referenced = [
  ...Object.values(manifest.icons ?? {}),
  ...Object.values(manifest.action?.default_icon ?? {}),
  manifest.action?.default_popup,
].filter(Boolean);
const missing = referenced.filter((p) => !files.includes(p));
if (missing.length) {
  console.error(`manifest references files that would not ship: ${missing.join(", ")}`);
  process.exit(1);
}

// MARK: Zip

const outDir = join(ROOT, "dist");
const out = join(outDir, `chat-extract-${manifest.version}.zip`);
mkdirSync(outDir, { recursive: true });
if (existsSync(out)) rmSync(out);
execFileSync("zip", ["-X", "-q", out, ...files], { cwd: ROOT, stdio: "inherit" });

console.log(`${relative(process.cwd(), out)} (${files.length} files, ${(statSync(out).size / 1024).toFixed(1)} KB)`);
for (const f of files) console.log(`  ${f}`);
