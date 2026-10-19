import { conversation, message, textPart } from "../ir.js";

// MARK: Page scrape
// scrape and list are serialized by chrome.scripting into the page's MAIN world, so they must not
// close over anything from this module, or each other. Failures come back as {pageError}, since
// some browsers drop an error thrown here (see tab.js). Uses claude.ai's own conversation API
// rather than the DOM, which only holds the rendered window of a long chat.
async function scrape(id = location.pathname.match(/\/chat\/([0-9a-f-]{36})/)?.[1]) {
  try {
    if (!id) throw new Error("Open a Claude conversation (claude.ai/chat/…) first.");
    // Accounts can belong to several orgs; the cookie is the one this page is showing.
    let org = document.cookie.match(/(?:^|;\s*)lastActiveOrg=([^;]+)/)?.[1];
    if (!org) {
      const res = await fetch("/api/organizations");
      if (!res.ok) throw new Error("Not logged in to Claude.");
      org = (await res.json())[0]?.uuid;
    }
    const res = await fetch(
      `/api/organizations/${org}/chat_conversations/${id}?tree=True&rendering_mode=messages&render_all_tools=true`,
    );
    if (!res.ok) throw new Error(`Claude API returned ${res.status}`);
    return await res.json();
  } catch (err) {
    return { pageError: err.message ?? String(err) };
  }
}

/** Pages by the count actually returned, since the server may cap `limit`; stops when a page adds nothing new. */
async function list() {
  try {
    let org = document.cookie.match(/(?:^|;\s*)lastActiveOrg=([^;]+)/)?.[1];
    if (!org) {
      const res = await fetch("/api/organizations");
      if (!res.ok) throw new Error("Not logged in to Claude.");
      org = (await res.json())[0]?.uuid;
    }
    const found = new Map();
    for (let offset = 0; ; ) {
      const res = await fetch(`/api/organizations/${org}/chat_conversations?limit=100&offset=${offset}`);
      if (!res.ok) throw new Error(`Claude API returned ${res.status}`);
      const items = await res.json();
      const before = found.size;
      for (const c of items) found.set(c.uuid, { id: c.uuid, title: c.name || "Untitled", url: `${location.origin}/chat/${c.uuid}` });
      offset += items.length;
      if (found.size === before) break;
    }
    return [...found.values()];
  } catch (err) {
    return { pageError: err.message ?? String(err) };
  }
}

// MARK: Canonicalize

const ROOT = "00000000-0000-4000-8000-000000000000";
const ROLES = { human: "user", assistant: "assistant" };

/** Messages on the branch the user is looking at; edits and retries fork the tree. */
function activeBranch(raw) {
  const byId = new Map(raw.chat_messages.map((m) => [m.uuid, m]));
  const leaf = byId.get(raw.current_leaf_message_uuid) ?? raw.chat_messages.at(-1);
  const path = [];
  for (let m = leaf; m && m.uuid !== ROOT; m = byId.get(m.parent_message_uuid)) path.push(m);
  return path.reverse();
}

/** Visible text only: thinking and tool calls/results are not part of what the user read. */
function visibleText(m) {
  const parts = (m.content ?? []).filter((p) => p.type === "text").map((p) => p.text.trim());
  return (parts.length ? parts.join("\n\n") : (m.text ?? "")).trim();
}

function toIR(raw, url) {
  const messages = activeBranch(raw)
    .filter((m) => ROLES[m.sender])
    .map((m) => ({ m, text: visibleText(m) }))
    .filter(({ text }) => text)
    .map(({ m, text }) =>
      message({
        id: m.uuid,
        role: ROLES[m.sender],
        created_at: m.created_at ?? null,
        model: m.sender === "assistant" ? (raw.model ?? null) : null,
        parts: [textPart(text)],
      }),
    );
  return {
    header: conversation({
      source: "claude",
      id: raw.uuid,
      title: raw.name || "Untitled",
      url,
      model: raw.model ?? null,
      created_at: raw.created_at ?? null,
      updated_at: raw.updated_at ?? null,
    }),
    messages,
  };
}

// MARK: Frontend

export default {
  id: "claude",
  label: "Claude",
  matches: (url) => /^https:\/\/claude\.ai\/chat\/[0-9a-f-]{36}/.test(url),
  scrape,
  toIR,
  onSite: (url) => /^https:\/\/claude\.ai\//.test(url),
  list,
};
