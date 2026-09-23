import chatgpt from "./chatgpt.js";
import claude from "./claude.js";

// MARK: Registry
// Add a site by writing a frontend module ({id, label, matches, scrape, toIR}) and listing it here.

export const frontends = [chatgpt, claude];

export const pickFrontend = (url) => frontends.find((f) => f.matches(url ?? ""));
