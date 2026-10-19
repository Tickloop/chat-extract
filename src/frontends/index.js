import chatgpt from "./chatgpt.js";
import claude from "./claude.js";

// MARK: Registry
// Add a site by writing a frontend module and listing it here:
//   { id, label,
//     matches(url), scrape(id?), toIR(raw, url),          one conversation; scrape() defaults to the open one
//                                                         page functions return {pageError} rather than throw
//     onSite(url), list() }                               optional, enables bulk export: list() -> [{id, title, url}]

export const frontends = [chatgpt, claude];

export const pickFrontend = (url) => frontends.find((f) => f.matches(url ?? ""));

/** Bulk export only needs to be on the site, not on a conversation. */
export const pickSite = (url) => frontends.find((f) => f.list && f.onSite(url ?? ""));
