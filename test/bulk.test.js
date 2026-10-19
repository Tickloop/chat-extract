import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { inflateRawSync, crc32 } from "node:zlib";

import chatgpt from "../src/frontends/chatgpt.js";
import claude from "../src/frontends/claude.js";
import { pickSite } from "../src/frontends/index.js";
import { parseJsonl } from "../src/ir.js";
import { createZip } from "../src/zip.js";
import { baseName } from "../src/archive.js";
import { exportAll } from "../src/bulk.js";

// MARK: Fixtures

const raw = JSON.parse(readFileSync(new URL("./fixtures/chatgpt-conversation.json", import.meta.url)));
const convo = (id, title = `Chat ${id}`) => ({ id, title, url: `https://chatgpt.com/c/${id}` });
// Real chats differ by id, which file names depend on.
const fetchAs = (c) => ({ ...raw, conversation_id: c.id });
const job = (fetchRaw, extra = {}) => ({ fetchRaw, toIR: chatgpt.toIR, folder: "export", retryDelayMs: 0, ...extra });

/** Reads entries back through the central directory, independently of how zip.js wrote them. */
async function readZip(blob) {
  const buf = Buffer.from(await blob.arrayBuffer());
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  const entries = new Map();
  for (let i = 0, at = buf.readUInt32LE(end + 16); i < count; i++) {
    const [crc, size, used, nameLen, local] = [16, 20, 24, 28, 42].map((o, j) => (j === 3 ? buf.readUInt16LE(at + o) : buf.readUInt32LE(at + o)));
    const name = buf.toString("utf8", at + 46, at + 46 + nameLen);
    const dataAt = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = inflateRawSync(buf.subarray(dataAt, dataAt + size));
    assert.equal(data.length, used, name);
    assert.equal(crc32(data), crc, name);
    entries.set(name, data.toString("utf8"));
    at += 46 + nameLen + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
  }
  return entries;
}

// MARK: Zip

test("zip entries round-trip with UTF-8 names and valid CRCs", async () => {
  const zip = createZip();
  await Promise.all([zip.add("a/ünïcødé.txt", "héllo\n".repeat(500)), zip.add("b.bin", new Uint8Array([0, 255, 1]))]);
  const entries = await readZip(zip.finish());
  assert.equal(entries.get("a/ünïcødé.txt"), "héllo\n".repeat(500));
  assert.equal(entries.get("b.bin"), "\u0000�\u0001");
});

test("an empty zip is still a valid archive", async () => {
  assert.equal((await readZip(createZip().finish())).size, 0);
});

// MARK: Frontends

test("bulk export is offered anywhere on a supported site", () => {
  assert.equal(pickSite("https://chatgpt.com/")?.id, "chatgpt");
  assert.equal(pickSite("https://chat.openai.com/gpts")?.id, "chatgpt");
  assert.equal(pickSite("https://claude.ai/recents")?.id, "claude");
  assert.equal(pickSite("https://example.com/"), undefined);
  assert.ok([chatgpt, claude].every((f) => typeof f.list === "function"));
});

test("page functions report failures as {pageError} instead of throwing", async (t) => {
  // Some browsers drop a throw from an injected function, so the message must travel as data.
  t.mock.method(globalThis, "fetch", async (url) =>
    String(url).endsWith("/api/auth/session") ? Response.json({ accessToken: "t" }) : new Response("", { status: 429 }),
  );
  globalThis.location = { origin: "https://chatgpt.com", pathname: "/" };
  globalThis.document = { cookie: "lastActiveOrg=org" };
  globalThis.window = {};
  t.after(() => (delete globalThis.location, delete globalThis.document, delete globalThis.window));

  assert.deepEqual(await chatgpt.scrape("abc"), { pageError: "ChatGPT API returned 429" });
  assert.deepEqual(await chatgpt.list(), { pageError: "ChatGPT API returned 429" });
  assert.deepEqual(await claude.scrape("abc"), { pageError: "Claude API returned 429" });
  assert.deepEqual(await claude.list(), { pageError: "Claude API returned 429" });
  assert.deepEqual(await chatgpt.scrape(), { pageError: "Open a ChatGPT conversation (/c/… or /share/…) first." });
});

// MARK: Export all

test("writes each chat as Markdown and JSONL into one folder", async () => {
  const progress = [];
  const result = await exportAll([convo("1"), convo("2")], job(async (c) => fetchAs(c), { onProgress: (p) => progress.push(p.done) }));
  const entries = await readZip(result.zip);
  const names = [...entries.keys()].sort();
  const date = new Date(raw.update_time * 1000).toISOString().slice(0, 10);

  assert.equal(result.exported, 2);
  assert.deepEqual(progress, [1, 2]);
  assert.deepEqual(names, [
    `export/${date} Tar Directory Stream Pipe (1).jsonl`,
    `export/${date} Tar Directory Stream Pipe (1).md`,
    `export/${date} Tar Directory Stream Pipe (2).jsonl`,
    `export/${date} Tar Directory Stream Pipe (2).md`,
  ]);

  // The JSONL is the IR itself, so it can be converted to CLI sessions later.
  const ir = chatgpt.toIR(fetchAs(convo("1")), convo("1").url);
  assert.deepEqual(parseJsonl(entries.get(names[0])), ir);

  const md = entries.get(names[1]);
  assert.match(md, /^# Tar Directory Stream Pipe\n\n- Source: https:\/\/chatgpt\.com\/c\/1\n/);
  assert.equal(md.match(/^## (User|Assistant)/gm).length, ir.messages.length);
  assert.match(md, /## Assistant \(bidi\)\n\n/);
});

test("file names are safe and keep same-titled chats apart", () => {
  const ir = (id, title) => ({ header: { id, title } });
  const date = new Date("2026-01-02T03:04:05Z");
  assert.equal(baseName(ir("abcdef12-0000", 'a/b\\c: "d"?\n'), date), "2026-01-02 a b c d (abcdef12)");
  assert.equal(baseName(ir("x", "   "), date), "2026-01-02 Untitled (x)");
  // Capped in bytes, never splitting a character, so multibyte titles get fewer characters.
  assert.equal(baseName(ir("x", "y".repeat(200)), date), `2026-01-02 ${"y".repeat(100)} (x)`);
  assert.equal(baseName(ir("x", "क".repeat(100)), date), `2026-01-02 ${"क".repeat(33)} (x)`);
  assert.equal(baseName(ir("x", "😀".repeat(30)), date), `2026-01-02 ${"😀".repeat(25)} (x)`);
});

test("keeps going past failures, retries, and skips empty chats", async () => {
  const attempts = new Map();
  const fetchRaw = async (c) => {
    attempts.set(c.id, (attempts.get(c.id) ?? 0) + 1);
    if (c.id === "flaky" && attempts.get(c.id) === 1) throw new Error("429");
    if (c.id === "broken") throw new Error("ChatGPT API returned 500");
    return c.id === "empty" ? { ...fetchAs(c), current_node: null } : fetchAs(c);
  };
  const result = await exportAll([convo("ok"), convo("flaky"), convo("broken"), convo("empty")], job(fetchRaw));

  assert.equal(result.exported, 2);
  assert.deepEqual(result.empty.map((c) => c.id), ["empty"]);
  assert.deepEqual(result.failed.map((c) => [c.id, c.error]), [["broken", "ChatGPT API returned 500"]]);
  assert.equal(attempts.get("broken"), 6);
});

test("stopping cuts a pending backoff short", async () => {
  const controller = new AbortController();
  const fetchRaw = async (c) => {
    if (c.id === "1") {
      setTimeout(() => controller.abort(), 20);
      throw new Error("ChatGPT API returned 429");
    }
    return fetchAs(c);
  };
  const started = Date.now();
  const result = await exportAll([convo("1"), convo("2")], job(fetchRaw, { retryDelayMs: 10_000, signal: controller.signal, concurrency: 1 }));

  assert.ok(Date.now() - started < 1000, "waited out the 10s backoff");
  assert.equal(result.stopped, true);
  assert.deepEqual(result.failed.map((c) => [c.id, c.error]), [["1", "ChatGPT API returned 429"]]);
});

test("a rate limit pauses every lane, not just the failing chat", async () => {
  const starts = [];
  let failedAt = 0;
  const fetchRaw = async (c) => {
    starts.push([c.id, Date.now()]);
    if (c.id === "1" && !failedAt) {
      failedAt = Date.now();
      throw new Error("ChatGPT API returned 429");
    }
    await new Promise((r) => setTimeout(r, 5));
    return fetchAs(c);
  };
  const waits = [];
  const result = await exportAll(["1", "2", "3", "4", "5"].map((id) => convo(id)), job(fetchRaw, { retryDelayMs: 100, onWait: (w) => waits.push(w) }));

  assert.equal(result.exported, 5);
  assert.deepEqual(waits.map((w) => [w.until - failedAt >= 99, w.error]), [[true, "ChatGPT API returned 429"]]);
  // Chats 2 and 3 were already in flight; every fetch that started after the 429 waited out the backoff.
  const after = starts.filter(([, t]) => t > failedAt + 1);
  assert.deepEqual(after.map(([id]) => id).sort(), ["1", "4", "5"]);
  assert.ok(after.every(([, t]) => t >= failedAt + 95), JSON.stringify({ failedAt, after }));
});

test("stopping keeps what was already exported", async () => {
  const controller = new AbortController();
  const fetchRaw = async (c) => (c.id === "2" && controller.abort(), fetchAs(c));
  const result = await exportAll(["1", "2", "3", "4"].map((id) => convo(id)), job(fetchRaw, { signal: controller.signal, concurrency: 1 }));

  assert.equal(result.stopped, true);
  assert.equal(result.exported, 2);
  assert.equal((await readZip(result.zip)).size, 4);
});

test("unzip extracts the folder with each chat's last activity as mtime", async () => {
  // A long multibyte title: macOS's unzip mangles such names unless the zip claims a Unix origin.
  const fetchRaw = async (c) => ({ ...fetchAs(c), ...(c.id === "2" && { title: "क".repeat(100) }) });
  const result = await exportAll([convo("1"), convo("2")], job(fetchRaw, { concurrency: 1 }));
  const dir = mkdtempSync(join(tmpdir(), "chat-extract-bulk-"));
  writeFileSync(join(dir, "export.zip"), Buffer.from(await result.zip.arrayBuffer()));

  // A too-long name makes unzip prompt; answering "n" fails the run instead of hanging it.
  execFileSync("unzip", ["-q", "export.zip"], { cwd: dir, input: "n\n" });
  const listed = execFileSync("find", ["export", "-type", "f"], { cwd: dir, encoding: "utf8" }).trim().split("\n").sort();
  assert.equal(listed.length, 4);
  assert.ok(listed.some((f) => f.includes("क".repeat(33))), "UTF-8 name extracted intact");
  assert.equal(statSync(join(dir, listed[0])).mode & 0o777, 0o644);
  // DOS times have 2s resolution and are local time, which unzip maps back.
  const drift = Math.abs(statSync(join(dir, listed[0])).mtimeMs - raw.update_time * 1000);
  assert.ok(drift <= 2000, `mtime off by ${drift}ms`);
});
