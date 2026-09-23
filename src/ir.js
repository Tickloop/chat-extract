// MARK: Schema
// The IR is the only contract between frontends and backends, so every field a backend
// might need must live here rather than being re-derived from source-specific data.

export const IR_VERSION = 1;

/**
 * @typedef {{type: "text", text: string}} TextPart
 * Unknown part types must be ignored by backends so new ones can be added without a version bump.
 * @typedef {TextPart | {type: string, [k: string]: unknown}} Part
 *
 * @typedef {{
 *   type: "conversation", ir_version: number, source: string, id: string, title: string,
 *   url: string, model: string | null, created_at: string | null, updated_at: string | null
 * }} ConversationHeader
 *
 * @typedef {{
 *   type: "message", id: string, role: "user" | "assistant", created_at: string | null,
 *   modality: "text" | "voice", model: string | null, parts: Part[]
 * }} Message
 *
 * @typedef {{header: ConversationHeader, messages: Message[]}} IR
 */

// MARK: Builders

/** @returns {ConversationHeader} */
export function conversation({ source, id, title, url, model = null, created_at = null, updated_at = null }) {
  return { type: "conversation", ir_version: IR_VERSION, source, id, title, url, model, created_at, updated_at };
}

/** @returns {Message} */
export function message({ id, role, created_at = null, modality = "text", model = null, parts }) {
  return { type: "message", id, role, created_at, modality, model, parts };
}

export const textPart = (text) => ({ type: "text", text });

// MARK: Helpers

/** Joins the text parts of a message; backends that only speak plain text use this. */
export function messageText(msg) {
  return msg.parts.filter((p) => p.type === "text").map((p) => p.text).join("\n");
}

// MARK: Serialization

/** @param {IR} ir */
export function toJsonl(ir) {
  return [ir.header, ...ir.messages].map((l) => JSON.stringify(l)).join("\n") + "\n";
}

/** @returns {IR} */
export function parseJsonl(text) {
  const [header, ...messages] = text.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  if (header?.type !== "conversation") throw new Error("IR must start with a conversation header");
  return { header, messages: messages.filter((m) => m.type === "message") };
}
