import { messageText } from "../ir.js";

// MARK: Format notes
// Mirrors ~/.claude/projects/<encoded-cwd>/<session>.jsonl as written by Claude Code 2.1.x.
// Every export gets fresh UUIDs: a still-open `claude --resume` of an earlier export would
// otherwise append to a chain whose parents we just rewrote, and the session loads empty.

const DEFAULT_MODEL = "claude-opus-5-5";
const CLAUDE_VERSION = "2.1.280";

/** Claude Code keys project folders by cwd with every non-alphanumeric char replaced by '-'. */
export const encodeProjectDir = (cwd) => cwd.replace(/[^a-zA-Z0-9]/g, "-");

// MARK: Render

function render(ir, { projectPath, claudeModel = DEFAULT_MODEL, uuid = () => crypto.randomUUID() }) {
  const sessionId = uuid();
  let parentUuid = null;
  let lastTs = ir.header.created_at ?? new Date().toISOString();

  const lines = ir.messages.map((m) => {
    lastTs = m.created_at ?? lastTs;
    const text = messageText(m);
    const line = {
      parentUuid,
      isSidechain: false,
      type: m.role,
      uuid: uuid(),
      timestamp: lastTs,
      userType: "external",
      entrypoint: "cli",
      cwd: projectPath,
      sessionId,
      version: CLAUDE_VERSION,
      message:
        m.role === "user"
          ? { role: "user", content: text }
          : {
              id: `msg_${m.id.replace(/-/g, "")}`,
              type: "message",
              role: "assistant",
              // Claude Code restores the session model from this and warns on non-Claude slugs like ChatGPT's "bidi".
              model: claudeModel,
              content: [{ type: "text", text }],
              stop_reason: "end_turn",
              stop_sequence: null,
              usage: { input_tokens: 0, output_tokens: 0 },
            },
    };
    parentUuid = line.uuid;
    return line;
  });
  lines.push({ type: "ai-title", aiTitle: ir.header.title, sessionId });

  const dir = encodeProjectDir(projectPath);
  return [
    {
      path: `chat-extract/claude/${dir}/${sessionId}.jsonl`,
      content: lines.map((l) => JSON.stringify(l)).join("\n") + "\n",
      meta: { sessionId, dir },
    },
  ];
}

// MARK: Backend

export default {
  id: "claude-code",
  label: "Claude Code",
  needsProjectPath: true,
  options: [{ key: "claudeModel", label: "Claude model", default: DEFAULT_MODEL }],
  render,
  install: ({ meta }) => ({ dir: `.claude/projects/${meta.dir}`, resume: `claude --resume ${meta.sessionId}` }),
};
