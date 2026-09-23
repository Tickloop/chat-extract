import { conversation, message, textPart } from "../ir.js";

// MARK: Page scrape
// Serialized by chrome.scripting into the page's MAIN world, so it must not close over
// anything from this module. Reads app data instead of the DOM because ChatGPT lazily
// renders long chats and the DOM holds only a window of messages.
async function scrape() {
  const loaderData = window.__reactRouterDataRouter?.state?.loaderData ?? {};
  const shared = Object.values(loaderData).find((v) => v?.serverResponse?.data?.mapping);
  if (shared) return shared.serverResponse.data;

  const id = location.pathname.match(/\/c\/([0-9a-f-]+)/)?.[1];
  if (!id) throw new Error("Open a ChatGPT conversation (/c/… or /share/…) first.");
  const session = await (await fetch("/api/auth/session")).json();
  if (!session.accessToken) throw new Error("Not logged in to ChatGPT.");
  const res = await fetch(`/backend-api/conversation/${id}`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });
  if (!res.ok) throw new Error(`ChatGPT API returned ${res.status}`);
  return res.json();
}

// MARK: Canonicalize

const VISIBLE_CONTENT = new Set(["text", "multimodal_text"]);

const iso = (secs) => (secs ? new Date(secs * 1000).toISOString() : null);

/** Messages on the branch the user is looking at; edits fork the tree, current_node picks the leaf. */
function activeBranch(raw) {
  const path = [];
  for (let id = raw.current_node; id; id = raw.mapping[id]?.parent) path.push(raw.mapping[id]);
  return path.reverse().map((node) => node?.message).filter(Boolean);
}

function isVisibleTurn(m) {
  return (
    (m.author.role === "user" || m.author.role === "assistant") &&
    m.recipient === "all" &&
    !m.metadata?.is_visually_hidden_from_conversation &&
    VISIBLE_CONTENT.has(m.content?.content_type)
  );
}

function partText(part) {
  if (typeof part === "string") return part;
  if (part?.content_type === "audio_transcription") return part.text ?? "";
  return "";
}

function toIR(raw, url) {
  const messages = activeBranch(raw)
    .filter(isVisibleTurn)
    .map((m) => ({ m, text: (m.content.parts ?? []).map(partText).join("\n").trim() }))
    .filter(({ text }) => text)
    .map(({ m, text }) =>
      message({
        id: m.id,
        role: m.author.role,
        created_at: iso(m.create_time),
        modality: m.content.content_type === "multimodal_text" ? "voice" : "text",
        model: m.metadata?.model_slug ?? null,
        parts: [textPart(text)],
      }),
    );
  return {
    header: conversation({
      source: "chatgpt",
      id: raw.conversation_id,
      title: raw.title ?? "Untitled",
      url,
      model: raw.default_model_slug ?? null,
      created_at: iso(raw.create_time),
      updated_at: iso(raw.update_time),
    }),
    messages,
  };
}

// MARK: Frontend

export default {
  id: "chatgpt",
  label: "ChatGPT",
  matches: (url) => /^https:\/\/(chatgpt\.com|chat\.openai\.com)\/(c|share)\//.test(url),
  scrape,
  toIR,
};
