import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync, rmSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

import chatgpt from "../src/frontends/chatgpt.js";
import { pickFrontend } from "../src/frontends/index.js";
import { backends } from "../src/backends/index.js";
import { toJsonl, parseJsonl, messageText } from "../src/ir.js";
import { renderAll, projectPathProblem, installCommand, resumeCommands } from "../src/pipeline.js";

// MARK: Fixture

// Synthetic, but shaped like ChatGPT's conversation mapping: hidden system nodes, a web search
// with its tool result, thoughts, an abandoned edit branch, voice turns and an empty reply.
const raw = JSON.parse(readFileSync(new URL("./fixtures/chatgpt-conversation.json", import.meta.url)));
const URL_ = "https://chatgpt.com/c/6aaf0000-0000-8000-8000-000000000001";
const ir = chatgpt.toIR(raw, URL_);
const OPTS = { projectPath: "/Users/you/code/project", claudeModel: "claude-opus-5-5" };
const parseLines = (content) => content.trim().split("\n").map((l) => JSON.parse(l));

// MARK: Frontend

test("picks the ChatGPT frontend for chat and share URLs only", () => {
  assert.equal(pickFrontend(URL_)?.id, "chatgpt");
  assert.equal(pickFrontend("https://chatgpt.com/c/abc-123")?.id, "chatgpt");
  assert.equal(pickFrontend("https://chatgpt.com/"), undefined);
  assert.equal(pickFrontend("https://example.com/c/x"), undefined);
});

test("keeps only the visible turns of the active branch", () => {
  assert.equal(ir.header.title, "Tar Directory Stream Pipe");
  assert.deepEqual(ir.messages.map((m) => m.id), ["u1", "a1", "u2", "a2"]);
  assert.deepEqual(ir.messages.map((m) => m.modality), ["text", "text", "voice", "voice"]);
  assert.equal(messageText(ir.messages[2]), "And compare two dirs by sha256?");
  assert.equal(ir.messages[3].model, "bidi");
});

// MARK: IR

test("IR round-trips through JSONL", () => {
  assert.deepEqual(parseJsonl(toJsonl(ir)), ir);
});

// MARK: Backends

test("Claude Code session has an unbroken chain and Claude-only models", () => {
  const [file] = renderAll(ir, ["claude-code"], OPTS);
  const lines = parseLines(file.content);
  const turns = lines.filter((l) => l.uuid);
  const ids = new Set(turns.map((l) => l.uuid));

  assert.match(file.path, /^chat-extract\/claude\/-Users-you-code-project\/[0-9a-f-]{36}\.jsonl$/);
  assert.equal(turns.length, 4);
  assert.equal(turns[0].parentUuid, null);
  assert.ok(turns.slice(1).every((l) => ids.has(l.parentUuid)));
  assert.ok(turns.filter((l) => l.type === "assistant").every((l) => l.message.model === "claude-opus-5-5"));
  assert.equal(lines.at(-1).type, "ai-title");
});

test("Claude Code exports never reuse a session id", () => {
  const [a] = renderAll(ir, ["claude-code"], OPTS);
  const [b] = renderAll(ir, ["claude-code"], OPTS);
  assert.notEqual(a.path, b.path);
});

test("Codex rollout carries what both the model and the TUI need on resume", () => {
  const now = new Date(2026, 8, 22, 15, 4, 5);
  const [file] = renderAll(ir, ["codex"], { ...OPTS, codexModel: "gpt-test", now });
  const lines = parseLines(file.content);
  const [meta] = lines;
  const of = (type, sub) => lines.filter((l) => l.type === type && (!sub || l.payload.type === sub));

  assert.match(file.path, /^chat-extract\/codex\/2026\/09\/22\/rollout-2026-09-22T15-04-05-[0-9a-f-]{36}\.jsonl$/);
  assert.equal(meta.type, "session_meta");
  assert.equal(meta.payload.cwd, OPTS.projectPath);
  // The TUI only renders history for paginated threads.
  assert.equal(meta.payload.history_mode, "paginated");
  assert.ok(lines.every((l, i) => l.ordinal === i));

  // Model context.
  assert.equal(of("response_item", "message").length, 4);

  // TUI history: items without thread_id are silently dropped by Codex.
  const items = of("event_msg", "item_completed");
  assert.equal(items.length, 4);
  assert.ok(items.every((l) => l.payload.thread_id === meta.payload.id));
  assert.deepEqual([...new Set(items.map((l) => l.payload.item.type))].sort(), ["AgentMessage", "UserMessage"]);

  // One turn per user message, each restoring the configured model.
  const turns = of("turn_context");
  assert.equal(turns.length, 2);
  assert.ok(turns.every((l) => l.payload.model === "gpt-test"));
  assert.equal(of("event_msg", "task_started").length, of("event_msg", "task_complete").length);
});

test("backend options have defaults so blank settings never export an empty model", () => {
  const options = backends.flatMap((b) => b.options ?? []);
  assert.deepEqual(options.map((o) => o.key).sort(), ["claudeModel", "codexModel"]);
  assert.ok(options.every((o) => o.default));
});

test("every selected backend yields one installable file", () => {
  const files = renderAll(ir, ["claude-code", "codex"], OPTS);
  assert.equal(files.length, 2);
  assert.match(files[0].install.dir, /^\.claude\/projects\//);
  assert.match(files[1].install.dir, /^\.codex\/sessions\/\d{4}\/\d{2}\/\d{2}$/);
});

// MARK: Install command

test("install command falls back to ~/Downloads and resume commands cd into the project", () => {
  const files = renderAll(ir, ["claude-code", "codex"], OPTS);
  const cmd = installCommand(files);
  assert.equal(cmd.match(/ && mv /g).length, 2);
  assert.ok(cmd.includes(`"$HOME/Downloads/${files[0].path}"`));

  const [claude, codex] = resumeCommands(files, OPTS.projectPath);
  assert.deepEqual(claude, {
    label: "Claude Code",
    command: `cd '${OPTS.projectPath}' && claude --resume ${files[0].meta.sessionId}`,
  });
  assert.deepEqual(codex, {
    label: "Codex CLI",
    command: `cd '${OPTS.projectPath}' && codex resume ${files[1].meta.sessionId}`,
  });
});

test("install command moves files from their real saved paths when run", () => {
  const home = mkdtempSync(join(tmpdir(), "chat-extract-"));
  const downloads = join(home, "My Downloads", "it's here");
  const files = renderAll(ir, ["claude-code", "codex"], OPTS).map((f) => {
    const savedPath = join(downloads, f.path);
    mkdirSync(dirname(savedPath), { recursive: true });
    writeFileSync(savedPath, f.content);
    return { ...f, savedPath };
  });

  execFileSync("sh", ["-c", installCommand(files)], { env: { ...process.env, HOME: home } });

  for (const f of files) {
    const dest = join(home, f.install.dir, basename(f.path));
    assert.ok(existsSync(dest), `missing ${dest}`);
    assert.ok(!existsSync(f.savedPath), `not moved ${f.savedPath}`);
  }
  rmSync(home, { recursive: true, force: true });
});

test("agent backends require an absolute project path", () => {
  assert.equal(projectPathProblem([], ""), null);
  assert.match(projectPathProblem(["codex"], " "), /Set a project path/);
  assert.match(projectPathProblem(["claude-code"], "~/code/app"), /absolute/);
  assert.match(projectPathProblem(["claude-code"], "code/app"), /absolute/);
  assert.equal(projectPathProblem(["claude-code"], "/tmp/x"), null);
});
