// MARK: Bump
// Chrome reads the version from manifest.json and npm from package.json, so both move together.
// Not `npm version`: that also commits and tags, and git is left to the maintainer.
// Usage: npm run bump [patch|minor|major|x.y.z]   (default: patch)

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FILES = ["manifest.json", "package.json"];
// Rewrites only the value, so the hand-formatted manifest keeps its layout and the diff is one line.
const VERSION_FIELD = /("version"\s*:\s*")([^"]*)(")/g;
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

const fail = (msg) => (console.error(msg), process.exit(1));

// MARK: Read

const sources = FILES.map((name) => {
  const text = readFileSync(join(ROOT, name), "utf8");
  const found = [...text.matchAll(VERSION_FIELD)];
  if (found.length !== 1) fail(`${name}: expected one "version" field, found ${found.length}`);
  return { name, text, version: found[0][2] };
});

const current = sources[0].version;
const drifted = sources.filter((s) => s.version !== current);
if (drifted.length) fail(`versions disagree: ${sources.map((s) => `${s.name}=${s.version}`).join(", ")}`);
if (!SEMVER.test(current)) fail(`current version ${current} is not x.y.z`);

// MARK: Next version

const parts = (v) => v.match(SEMVER).slice(1).map(Number);
const compare = (a, b) => parts(a).reduce((acc, n, i) => acc || n - parts(b)[i], 0);

function next(arg = "patch") {
  const [major, minor, patch] = parts(current);
  if (arg === "major") return `${major + 1}.0.0`;
  if (arg === "minor") return `${major}.${minor + 1}.0`;
  if (arg === "patch") return `${major}.${minor}.${patch + 1}`;
  if (!SEMVER.test(arg)) fail(`expected patch, minor, major or x.y.z, got "${arg}"`);
  // The Chrome Web Store rejects an upload whose version isn't higher than the published one.
  if (compare(arg, current) <= 0) fail(`${arg} is not higher than ${current}`);
  return arg;
}

const version = next(process.argv[2]);

// MARK: Write

for (const s of sources) writeFileSync(join(ROOT, s.name), s.text.replace(VERSION_FIELD, `$1${version}$3`));
console.log(`${current} → ${version} (${FILES.join(", ")})`);
