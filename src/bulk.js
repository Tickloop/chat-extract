import { formats, baseName } from "./archive.js";
import { createZip } from "./zip.js";

// MARK: Bulk export
// Kept free of chrome.* like the pipeline: the caller injects how one conversation is fetched.

/**
 * @param {{id: string, title: string, url: string}[]} convos from a frontend's list()
 * @param {{fetchRaw: (c) => Promise<unknown>, toIR: Function, folder: string, onProgress?: Function,
 *   onWait?: ({until: number, error: string}) => void, signal?: AbortSignal, concurrency?: number,
 *   retries?: number, retryDelayMs?: number}} job
 */
export async function exportAll(convos, job) {
  const { fetchRaw, toIR, folder, onProgress = () => {}, signal, concurrency = 3 } = job;
  const zip = createZip();
  const report = { exported: 0, empty: [], failed: [], done: 0, total: convos.length };
  const fetchWithRetry = retrying(fetchRaw, job);

  await pool(convos, concurrency, signal, async (c) => {
    try {
      const ir = toIR(await fetchWithRetry(c), c.url);
      if (ir.messages.length) {
        const updated = lastActivity(ir);
        const name = `${folder}/${baseName(ir, updated)}`;
        for (const f of formats) await zip.add(`${name}.${f.ext}`, f.render(ir), updated);
        report.exported++;
      } else report.empty.push(c);
    } catch (err) {
      report.failed.push({ ...c, error: err.message ?? String(err) });
    }
    report.done++;
    onProgress({ ...report, title: c.title });
  });

  return { ...report, stopped: Boolean(signal?.aborted), zip: zip.finish() };
}

/** Used as each file's mtime and name date, so the archive sorts by when the chat was last active. */
function lastActivity(ir) {
  const d = new Date(ir.header.updated_at ?? ir.header.created_at ?? ir.messages.at(-1).created_at);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

// MARK: Scheduling
// A few requests at a time: the sites rate-limit their APIs (ChatGPT answers 429 with a
// Retry-After of a few seconds), and a burst of hundreds gets refused.

async function pool(items, size, signal, worker) {
  let next = 0;
  const lane = async () => {
    while (next < items.length && !signal?.aborted) await worker(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, lane));
}

/**
 * Rate limits are per account, not per request, so a failure pauses every lane until its backoff
 * ends; retrying one chat while the others keep firing would only extend the limit.
 */
function retrying(fetchRaw, { retries = 5, retryDelayMs = 2000, onWait = () => {}, signal }) {
  let resumeAt = 0;
  // Wakes early on Stop, so a pending backoff never holds up saving what is already done.
  const sleep = (ms) =>
    new Promise((resolve) => {
      const done = () => (clearTimeout(timer), signal?.removeEventListener("abort", done), resolve());
      const timer = setTimeout(done, Math.max(0, ms));
      signal?.addEventListener("abort", done);
    });
  return async (c) => {
    let lastError;
    for (let attempt = 0; ; attempt++) {
      await sleep(resumeAt - Date.now());
      if (lastError && signal?.aborted) throw lastError;
      try {
        return await fetchRaw(c);
      } catch (err) {
        lastError = err;
        if (attempt >= retries) throw err;
        resumeAt = Math.max(resumeAt, Date.now() + retryDelayMs * 2 ** attempt);
        onWait({ until: resumeAt, error: err.message ?? String(err) });
      }
    }
  };
}
