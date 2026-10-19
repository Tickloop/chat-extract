import { frontends, pickFrontend, pickSite } from "../src/frontends/index.js";
import { backends } from "../src/backends/index.js";
import { renderAll, projectPathProblem, installCommand, resumeCommands } from "../src/pipeline.js";
import { download } from "../src/download.js";
import { runInTab } from "../src/tab.js";
import { createPageStack } from "./pages.js";
import { renderCommands, wireCopyButtons } from "./commands.js";
import { OPTIONS, loadSettings, save, optionValues } from "./settings.js";
import { openBulkExport } from "./bulk.js";

// MARK: State

const $ = (id) => document.getElementById(id);
const selectedIds = () => [...document.querySelectorAll("#backends input:checked")].map((i) => i.value);

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
  renderCommands($("resume-cmds"), resume);
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

async function onExport(tab, frontend) {
  const ids = selectedIds();
  const opts = { projectPath: $("projectPath").value.trim(), ...optionValues(await loadSettings()) };
  const pathProblem = projectPathProblem(ids, opts.projectPath);
  if (pathProblem) return setStatus(pathProblem, true);

  $("go").disabled = true;
  setStatus("Reading conversation…");
  try {
    const ir = frontend.toIR(await runInTab(tab.id, frontend.scrape), tab.url);
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

// MARK: Bulk export

function onBulkExport(tab, site) {
  pages.push("bulk-page");
  openBulkExport(tab.id, site);
}

// MARK: Init

async function init() {
  const settings = await loadSettings();

  // Settings work on any page, so wire them before bailing out on unsupported tabs.
  renderSettings(settings);
  pages = createPageStack($("viewport"), "export-page", { onChange: syncSettingsButton });
  $("toggle-settings").addEventListener("click", toggleSettings);
  wireCopyButtons();
  document.querySelectorAll("[data-back]").forEach((btn) => btn.addEventListener("click", () => pages.pop()));
  await restoreLastExport();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const frontend = pickFrontend(tab?.url);
  const site = pickSite(tab?.url);
  if (!frontend && !site) {
    $("unsupported-text").textContent = `Open a ${frontends.map((f) => f.label).join(" or ")} conversation to export it.`;
    $("unsupported").hidden = false;
    return;
  }
  $("source").textContent = (frontend ?? site).label;

  if (site) {
    // Bulk is the page's main action when there is no single conversation to export.
    $("bulk").className = frontend ? "secondary" : "primary";
    $("bulk").addEventListener("click", () => onBulkExport(tab, site));
    $("bulk-section").hidden = false;
  }
  if (!frontend) return;

  renderBackends(settings.selected);
  $("projectPath").value = settings.projectPath;
  $("export").hidden = false;
  syncVisibility();

  $("export").addEventListener("change", () => (syncVisibility(), save({ selected: selectedIds() })));
  $("projectPath").addEventListener("input", () => (save({ projectPath: $("projectPath").value }), chrome.storage.local.remove(LAST_EXPORT)));
  $("export").addEventListener("submit", (e) => (e.preventDefault(), onExport(tab, frontend)));
}

init();
