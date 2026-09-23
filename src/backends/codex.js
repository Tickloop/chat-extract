import { messageText } from "../ir.js";

// MARK: Format notes
// Mirrors ~/.codex/sessions/YYYY/MM/DD/rollout-<local-ts>-<id>.jsonl as written by Codex CLI 0.154.
// response_items are what the model sees on resume; the TUI instead renders history from
// item_completed events and restores the model from turn_context, so each turn carries all three.

const CODEX_VERSION = "0.154.0";
const DEFAULT_MODEL = "gpt-6-astra";

const pad = (n) => String(n).padStart(2, "0");

/** Codex names and files rollouts by local wall-clock time, not UTC. */
function localStamp(d) {
  const date = [d.getFullYear(), pad(d.getMonth() + 1), pad(d.getDate())];
  const time = [pad(d.getHours()), pad(d.getMinutes()), pad(d.getSeconds())];
  return { dir: date.join("/"), file: `${date.join("-")}T${time.join("-")}` };
}

/** A turn is a user message plus the assistant replies that follow it. */
function toTurns(messages) {
  const turns = [];
  for (const m of messages) {
    if (m.role === "user" || turns.length === 0) turns.push([]);
    turns.at(-1).push(m);
  }
  return turns;
}

// MARK: Turn lines

function turnLines(turn, { threadId, turnId, uuid, cwd, model, fallbackTs }) {
  const ts = (m) => m?.created_at ?? fallbackTs;
  const secs = (m) => Math.floor(Date.parse(ts(m)) / 1000);
  const ms = (m) => Date.parse(ts(m));
  const lastAssistant = turn.findLast((m) => m.role === "assistant");

  const lines = [
    [ts(turn[0]), "event_msg", { type: "task_started", turn_id: turnId, started_at: secs(turn[0]), collaboration_mode_kind: "default" }],
    [
      ts(turn[0]),
      "turn_context",
      {
        turn_id: turnId,
        root_turn_id: turnId,
        cwd,
        workspace_roots: [cwd],
        current_date: ts(turn[0]).slice(0, 10),
        approval_policy: "on-request",
        sandbox_policy: { type: "read-only" },
        model,
        summary: "auto",
      },
    ],
  ];

  for (const m of turn) {
    const text = messageText(m);
    const id = m.role === "user" ? uuid() : `msg_${uuid()}`;
    const item =
      m.role === "user"
        ? { type: "UserMessage", id, client_id: uuid(), content: [{ type: "text", text, text_elements: [] }] }
        : { type: "AgentMessage", id, content: [{ type: "Text", text }], phase: "final_answer" };
    lines.push(
      [ts(m), "response_item", {
        type: "message",
        id: `msg_${uuid()}`,
        role: m.role,
        content: [{ type: m.role === "user" ? "input_text" : "output_text", text }],
        ...(m.role === "assistant" && { phase: "final_answer" }),
      }],
      [ts(m), "event_msg", { type: "item_completed", thread_id: threadId, turn_id: turnId, item, started_at_ms: ms(m), completed_at_ms: ms(m) }],
    );
  }

  const end = turn.at(-1);
  lines.push([ts(end), "event_msg", {
    type: "task_complete",
    turn_id: turnId,
    last_agent_message: lastAssistant ? messageText(lastAssistant) : null,
    started_at: secs(turn[0]),
    completed_at: secs(end),
  }]);
  return lines;
}

// MARK: Render

function render(ir, { projectPath, codexModel = DEFAULT_MODEL, uuid = () => crypto.randomUUID(), now = new Date() }) {
  const sessionId = uuid();
  const ts = now.toISOString();
  const meta = {
    session_id: sessionId,
    id: sessionId,
    timestamp: ts,
    cwd: projectPath,
    originator: "codex-tui",
    cli_version: CODEX_VERSION,
    source: "cli",
    thread_source: "user",
    model_provider: "openai",
    history_mode: "paginated",
  };

  const body = toTurns(ir.messages).flatMap((turn) =>
    turnLines(turn, { threadId: sessionId, turnId: uuid(), uuid, cwd: projectPath, model: codexModel, fallbackTs: ts }),
  );
  const lines = [[ts, "session_meta", meta], ...body].map(([timestamp, type, payload], ordinal) => ({
    timestamp,
    ordinal,
    type,
    payload,
  }));

  const stamp = localStamp(now);
  return [
    {
      path: `chat-extract/codex/${stamp.dir}/rollout-${stamp.file}-${sessionId}.jsonl`,
      content: lines.map((l) => JSON.stringify(l)).join("\n") + "\n",
      meta: { sessionId, dir: stamp.dir },
    },
  ];
}

// MARK: Backend

export default {
  id: "codex",
  label: "Codex CLI",
  needsProjectPath: true,
  options: [{ key: "codexModel", label: "Codex model", default: DEFAULT_MODEL }],
  render,
  install: ({ meta }) => ({ dir: `.codex/sessions/${meta.dir}`, resume: `codex resume ${meta.sessionId}` }),
};
