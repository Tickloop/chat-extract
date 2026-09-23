import claudeCode from "./claude-code.js";
import codex from "./codex.js";

// MARK: Registry
// Add an agent format by writing a backend module and listing it here:
//   { id, label, needsProjectPath,
//     options: [{key, label, default}],                   shown on the popup's Settings page, passed to render via opts
//     render(ir, opts) -> [{path, content, meta}],        path is relative to the Downloads dir
//     install(file) -> {dir, resume} | null }             dir is relative to $HOME; null = leave in Downloads

export const backends = [claudeCode, codex];
