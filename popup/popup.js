import { frontends, pickFrontend } from "../src/frontends/index.js";
import { backends } from "../src/backends/index.js";
import { renderAll, projectPathProblem, installCommand, resumeCommands } from "../src/pipeline.js";
import { download } from "../src/download.js";
import { createPageStack } from "./pages.js";

// MARK: State
// Backend options (e.g. default models) are declared by the backends themselves, so the
// Settings page and stored defaults grow automatically when a backend is added.

const OPTIONS = backends.flatMap((b) => b.options ?? []);
const DEFAULTS = {
  selected: backends.map((b) => b.id),
  projectPath: "",
  ...Object.fromEntries(OPTIONS.map((o) => [o.key, o.default])),
};
const $ = (id) => document.getElementById(id);

async function loadSettings() {
  return { ...DEFAULTS, ...(await chrome.storage.local.get(Object.keys(DEFAULTS))) };
}

const save = (patch) => chrome.storage.local.set(patch);
const selectedIds = () => [...document.querySelectorAll("#backends input:checked")].map((i) => i.value);

/** Blank settings fall back to the backend's default instead of exporting an empty model. */
function optionValues(settings) {
  return Object.fromEntries(OPTIONS.map((o) => [o.key, settings[o.key]?.trim() || o.default]));
}

// MARK: Pages

let pages;

/** One header button opens Settings and, while it is open, closes it again. */
function toggleSettings() {
  if (pages.top() === "settings-page") pages.pop();
  else pages.push("settings-page");
}

function syncSettingsButton(top) {
  const open = top === "settings-page";
  const btn = $("toggle-settings");
  btn.textContent = open ? "✕" : "⚙";
  btn.title = open ? "Close settings" : "Settings";
  btn.setAttribute("aria-label", btn.title);
}

function renderSettings(settings) {
  $("backend-options").replaceChildren(
    ...OPTIONS.map((o) => {
      const label = document.createElement("label");
      const input = Object.assign(document.createElement("input"), {
        type: "text",
        id: `opt-${o.key}`,
        value: settings[o.key],
        placeholder: o.default,
        spellcheck: false,
      });
      input.addEventListener("input", () => save({ [o.key]: input.value }));
      label.append(`Default ${o.label}`, input);
      return label;
    }),
  );
}

// MARK: Export page

function setStatus(text, isError = false) {
  $("status").textContent = text;
  $("status").classList.toggle("error", isError);
}

function renderBackends(selected) {
  $("backends").replaceChildren(
    ...backends.map((b) => {
      const label = document.createElement("label");
      const box = Object.assign(document.createElement("input"), { type: "checkbox", value: b.id, checked: selected.includes(b.id) });
      label.append(box, b.label);
      return label;
    }),
  );
}

function syncVisibility() {
  const ids = selectedIds();
  $("project-path-field").hidden = !backends.some((b) => ids.includes(b.id) && b.needsProjectPath);
  $("go").disabled = ids.length === 0;
}

// MARK: Result page

function renderResult({ title, messageCount, install, resume }) {
  $("result-summary").textContent = `Exported “${title}” — ${messageCount} messages.`;
  $("install-cmd").textContent = install;
  $("resume-cmds").replaceChildren(
    ...resume.map(({ label, command }, i) => {
      const block = $("resume-tpl").content.cloneNode(true);
      const pre = block.querySelector("pre");
      pre.id = `resume-cmd-${i}`;
      pre.textContent = command;
      block.querySelector(".cmd-label").textContent = label;
      block.querySelector("[data-copy]").dataset.copy = pre.id;
      return block;
    }),
  );
}

// MARK: Last export
// Chrome closes the popup whenever it loses focus, usually the moment the user switches to a
// terminal to paste the install command. So the commands are kept until they stop applying:
// a new export replaces them, and editing the project path drops them.

const LAST_EXPORT = "lastExport";

async function restoreLastExport() {
  const { [LAST_EXPORT]: last } = await chrome.storage.local.get(LAST_EXPORT);
  if (!last) return;
  renderResult(last);
  pages.push("result-page", { animate: false });
}

// MARK: Export

async function scrapeTab(tab, frontend) {
  const [{ result, error } = {}] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "MAIN",
    func: frontend.scrape,
  });
  // Depending on the Chrome version a throw in the page either rejects or comes back as `error`.
  if (error) throw new Error(error.message ?? String(error));
  if (!result) throw new Error("Could not read the conversation from this page.");
  return result;
}

async function onExport(tab, frontend) {
  const ids = selectedIds();
  const opts = { projectPath: $("projectPath").value.trim(), ...optionValues(await loadSettings()) };
  const pathProblem = projectPathProblem(ids, opts.projectPath);
  if (pathProblem) return setStatus(pathProblem, true);

  $("go").disabled = true;
  setStatus("Reading conversation…");
  try {
    const ir = frontend.toIR(await scrapeTab(tab, frontend), tab.url);
    const rendered = renderAll(ir, ids, opts);
    const files = await Promise.all(rendered.map(async (f) => ({ ...f, savedPath: await download(f) })));
    const result = {
      title: ir.header.title,
      messageCount: ir.messages.length,
      install: installCommand(files),
      resume: resumeCommands(files, opts.projectPath),
    };
    save({ [LAST_EXPORT]: result });
    setStatus("");
    renderResult(result);
    pages.push("result-page");
  } catch (err) {
    setStatus(err.message ?? String(err), true);
  } finally {
    $("go").disabled = false;
  }
}

// MARK: Init

// Delegated because the resume blocks are rendered after init.
function wireButtons() {
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (btn?.matches("[data-back]")) pages.pop();
    if (btn?.dataset.copy) {
      await navigator.clipboard.writeText($(btn.dataset.copy).textContent);
      btn.textContent = "Copied";
      setTimeout(() => (btn.textContent = "Copy"), 1200);
    }
  });
}

async function init() {
  const settings = await loadSettings();

  // Settings work on any page, so wire them before bailing out on unsupported tabs.
  renderSettings(settings);
  pages = createPageStack($("viewport"), "export-page", { onChange: syncSettingsButton });
  $("toggle-settings").addEventListener("click", toggleSettings);
  wireButtons();
  await restoreLastExport();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const frontend = pickFrontend(tab?.url);
  if (!frontend) {
    $("unsupported-text").textContent = `Open a ${frontends.map((f) => f.label).join(" or ")} conversation to export it.`;
    $("unsupported").hidden = false;
    return;
  }
  $("source").textContent = frontend.label;

  renderBackends(settings.selected);
  $("projectPath").value = settings.projectPath;
  $("export").hidden = false;
  syncVisibility();

  $("export").addEventListener("change", () => (syncVisibility(), save({ selected: selectedIds() })));
  $("projectPath").addEventListener("input", () => (save({ projectPath: $("projectPath").value }), chrome.storage.local.remove(LAST_EXPORT)));
  $("export").addEventListener("submit", (e) => (e.preventDefault(), onExport(tab, frontend)));
}

init();
