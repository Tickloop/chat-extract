import { toJsonl, messageText } from "./ir.js";

// MARK: Formats
// A bulk archive spans every project, so unlike the CLI backends nothing here needs a project path.
// Each format writes one file per chat; add one by appending { ext, render(ir) -> string }.

const ROLE_HEADINGS = { user: "User", assistant: "Assistant" };

function markdown({ header, messages }) {
  const meta = [`- Source: ${header.url}`, header.created_at && `- Created: ${header.created_at}`, header.updated_at && `- Updated: ${header.updated_at}`];
  const turns = messages.map((m) => {
    const model = m.role === "assistant" && m.model ? ` (${m.model})` : "";
    return `## ${ROLE_HEADINGS[m.role]}${model}\n\n${messageText(m)}`;
  });
  return [`# ${header.title}`, meta.filter(Boolean).join("\n"), ...turns].join("\n\n") + "\n";
}

/** The IR keeps everything a CLI backend needs, so these can be converted to sessions later. */
export const formats = [
  { ext: "md", render: markdown },
  { ext: "jsonl", render: toJsonl },
];

// MARK: Naming
// File systems cap names at 255 bytes, not characters, and a character can take up to 4 bytes,
// so titles are capped in bytes with room left for the date, id and extension.

const MAX_TITLE_BYTES = 100;
const encoder = new TextEncoder();

function clipBytes(text, max) {
  let out = "";
  let used = 0;
  for (const ch of text) {
    used += encoder.encode(ch).length;
    if (used > max) break;
    out += ch;
  }
  return out;
}

/** Date first so a folder listing sorts by conversation; the id suffix keeps same-titled chats apart. */
export function baseName({ header }, date) {
  const clean = header.title.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  const title = clipBytes(clean, MAX_TITLE_BYTES).trim();
  return `${date.toISOString().slice(0, 10)} ${title || "Untitled"} (${header.id.slice(0, 8)})`;
}
