import { backends } from "./backends/index.js";

// MARK: Pipeline
// Kept free of chrome.* so the whole IR → files → install command step is unit-testable in node.

export function renderAll(ir, backendIds, opts) {
  return backends
    .filter((b) => backendIds.includes(b.id))
    .flatMap((b) => b.render(ir, opts).map((file) => ({ ...file, backend: b.label, install: b.install(file) })));
}

/**
 * Why the project path can't be used, or null. It must be absolute: the CLIs key sessions by the
 * literal cwd, and a quoted `~` would neither expand in the resume command nor match that cwd.
 */
export function projectPathProblem(backendIds, projectPath) {
  if (!backends.some((b) => backendIds.includes(b.id) && b.needsProjectPath)) return null;
  const path = projectPath?.trim() ?? "";
  if (!path) return "Set a project path first.";
  if (!path.startsWith("/")) return "Use an absolute project path, e.g. /Users/you/code/project.";
  return null;
}

// MARK: Install command

const shellQuote = (s) => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * One pasteable command that moves every installable file to its CLI's session dir.
 * `savedPath` is where Chrome actually wrote the file; without it we assume the default Downloads dir.
 */
export function installCommand(files) {
  return files
    .filter((f) => f.install)
    .map((f) => {
      const src = f.savedPath ? shellQuote(f.savedPath) : `"$HOME/Downloads/${f.path}"`;
      const dest = `"$HOME/${f.install.dir}"`;
      return `mkdir -p ${dest} && mv ${src} ${dest}/`;
    })
    .join(" && ");
}

/** CLIs look sessions up by cwd, so each resume must run from the exported project path. */
export function resumeCommands(files, projectPath) {
  return files
    .filter((f) => f.install)
    .map((f) => ({ label: f.backend, command: `cd ${shellQuote(projectPath)} && ${f.install.resume}` }));
}
