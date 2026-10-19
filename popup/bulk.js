import { exportAll } from "../src/bulk.js";
import { download } from "../src/download.js";
import { runInTab } from "../src/tab.js";

// MARK: Bulk export page
// Runs in the popup itself, so the export lives only as long as the popup does: Chrome closes it
// whenever it loses focus, and the page says so before the export starts.

const $ = (id) => document.getElementById(id);

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const size = (bytes) => (bytes < 1048576 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1048576).toFixed(1)} MB`);

function setStatus(text, isError = false) {
  $("bulk-status").textContent = text;
  $("bulk-status").classList.toggle("error", isError);
}

/** chrome.scripting's own wording means nothing to users; it fails like this once the tab is gone or reloaded. */
function friendly(message, frontend) {
  return /No tab with id|Cannot access|Frame with ID/.test(message)
    ? `Lost access to the ${frontend.label} tab. Reopen the popup there and start again.`
    : message;
}

// MARK: Progress

function renderProgress({ done, total, title }) {
  $("bulk-progress").max = total;
  $("bulk-progress").value = done;
  $("bulk-progress-text").textContent = `${done} of ${total} · ${title}`;
  setStatus("");
}

/** Backoffs grow to half a minute, which would otherwise look like a hung export. */
function renderWait({ until }, frontend) {
  setStatus(`${frontend.label} is limiting requests, retrying in ${Math.ceil((until - Date.now()) / 1000)}s…`);
}

function renderFailures(failed) {
  $("bulk-failures").hidden = failed.length === 0;
  $("bulk-failures").querySelector("summary").textContent = `${plural(failed.length, "chat")} could not be exported`;
  $("bulk-failure-list").replaceChildren(
    ...failed.map(({ title, url, error }) => {
      const li = document.createElement("li");
      const link = Object.assign(document.createElement("a"), { href: url, target: "_blank", textContent: title });
      li.append(link, ` — ${error}`);
      return li;
    }),
  );
}

// MARK: Export

async function run(tabId, frontend, convos) {
  const controller = new AbortController();
  const stop = () => (controller.abort(), ($("bulk-stop").disabled = true), ($("bulk-stop").textContent = "Stopping…"));
  $("bulk-stop").addEventListener("click", stop, { once: true });
  // Leaving the page mid-export would hide the only Stop button while the export runs on.
  $("bulk-back").disabled = true;
  $("bulk-start").hidden = true;
  $("bulk-progress-section").hidden = false;
  setStatus("");

  // The zip unpacks into a folder of the same name rather than spilling files into Downloads.
  const name = `chat-extract-${frontend.id}-${new Date().toLocaleDateString("sv-SE")}`;
  try {
    const result = await exportAll(convos, {
      fetchRaw: (c) => runInTab(tabId, frontend.scrape, [c.id]),
      toIR: frontend.toIR,
      folder: name,
      signal: controller.signal,
      onProgress: renderProgress,
      onWait: (wait) => renderWait(wait, frontend),
    });
    renderFailures(result.failed.map((f) => ({ ...f, error: friendly(f.error, frontend) })));
    if (!result.exported) return setStatus("No chats were exported.", true);

    setStatus("Saving the zip…");
    const file = { path: `${name}.zip`, content: result.zip };
    const savedPath = await download(file);
    const skipped = [
      result.stopped && `stopped after ${result.done} of ${result.total}`,
      result.empty.length && `${plural(result.empty.length, "empty chat")} skipped`,
      result.failed.length && `${result.failed.length} failed`,
    ].filter(Boolean);
    setStatus(
      `Saved ${plural(result.exported, "chat")} to ${savedPath ?? file.path} (${size(result.zip.size)})` +
        (skipped.length ? `; ${skipped.join(", ")}.` : "."),
    );
  } catch (err) {
    setStatus(friendly(err.message ?? String(err), frontend), true);
  } finally {
    $("bulk-progress-section").hidden = true;
    $("bulk-back").disabled = false;
  }
}

// MARK: Open
// The chat list is fetched once per popup: going Back and opening the page again keeps the
// finished export's result on screen instead of starting over.

let opened = false;

export async function openBulkExport(tabId, frontend) {
  if (opened) return;
  opened = true;

  setStatus(`Finding your ${frontend.label} chats…`);
  let convos;
  try {
    convos = await runInTab(tabId, frontend.list);
  } catch (err) {
    opened = false; // a transient failure can be retried by opening the page again
    return setStatus(friendly(err.message ?? String(err), frontend), true);
  }
  if (!convos.length) return setStatus(`No ${frontend.label} chats found.`, true);

  setStatus(`Found ${plural(convos.length, "chat")}.`);
  $("bulk-start").textContent = `Export ${plural(convos.length, "chat")} as .zip`;
  $("bulk-start").hidden = false;
  $("bulk-start").addEventListener("click", () => run(tabId, frontend, convos), { once: true });
}
