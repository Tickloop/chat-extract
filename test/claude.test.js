import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import claude from "../src/frontends/claude.js";
import { pickFrontend } from "../src/frontends/index.js";
import { messageText } from "../src/ir.js";
import { renderAll } from "../src/pipeline.js";

// MARK: Fixture
// Synthetic, but shaped like claude.ai's chat_conversations API: an edited turn forks the
// tree, assistant turns mix thinking / tool_use / tool_result with text, and the leaf is
// a thinking-only reply that should disappear.

const raw = JSON.parse(readFileSync(new URL("./fixtures/claude-conversation.json", import.meta.url)));
const URL_ = `https://claude.ai/chat/${raw.uuid}`;
const ir = claude.toIR(raw, URL_);

// MARK: Frontend

test("picks the Claude frontend for claude.ai chat URLs only", () => {
  assert.equal(pickFrontend("https://claude.ai/chat/09af30e9-05bd-493c-ac75-1b7fbb0808bc")?.id, "claude");
  assert.equal(pickFrontend("https://claude.ai/new"), undefined);
  assert.equal(pickFrontend("https://claude.ai/recents"), undefined);
});

test("follows the active branch, not abandoned edits", () => {
  assert.deepEqual(
    ir.messages.map((m) => m.id),
    ["m-1", "m-2", "m-3", "m-4", "m-5"],
  );
});

test("keeps only visible text: thinking and tool calls are dropped", () => {
  assert.deepEqual(
    ir.messages.map((m) => m.role),
    ["user", "assistant", "user", "assistant", "user"],
  );
  assert.equal(messageText(ir.messages[1]), "Use a token bucket keyed by user id.");
  assert.equal(
    messageText(ir.messages[3]),
    "Let me check the Redis docs.\n\nHere is an atomic Lua script for the bucket.",
  );
});

test("header carries title, model and source", () => {
  assert.equal(ir.header.source, "claude");
  assert.equal(ir.header.title, "Rate limiter design");
  assert.equal(ir.header.model, "claude-sonnet-5");
  assert.equal(ir.messages[1].model, "claude-sonnet-5");
  assert.equal(ir.messages[0].model, null);
});

// MARK: Backends

test("a Claude conversation renders through both backends", () => {
  const files = renderAll(ir, ["claude-code", "codex"], { projectPath: "/tmp/demo" });
  assert.equal(files.length, 2);
  const claudeLines = files[0].content.trim().split("\n").map((l) => JSON.parse(l)).filter((l) => l.uuid);
  assert.equal(claudeLines.length, 5);
});
