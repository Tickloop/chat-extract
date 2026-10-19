// MARK: Download
// Paths are relative to the browser's Downloads dir; chrome.downloads creates the subfolders,
// which lets rendered files keep the same layout as their destination under ~/.claude or ~/.codex.

/** @returns {Promise<string | null>} absolute path Chrome saved to, or null if it never reported one */
export async function download({ path, content }) {
  // A specific MIME type makes Chrome swap our extension for its own (x-ndjson → .ndjson),
  // but the CLIs only load *.jsonl; octet-stream leaves the filename alone.
  const url = URL.createObjectURL(new Blob([content], { type: "application/octet-stream" }));
  try {
    const id = await chrome.downloads.download({ url, filename: path, conflictAction: "uniquify", saveAs: false });
    return await savedPath(id);
  } finally {
    // Chrome reads the blob asynchronously after download() resolves, so revoke later.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

// MARK: Saved path
// The final path can differ from what we asked for (custom Downloads dir, " (1)" uniquify), and
// Chrome only fills it in once the target is determined. For a zip that waits on Safe Browsing's
// archive scan, which can take seconds, so wait for the change event rather than poll briefly.

function savedPath(id, timeoutMs = 15_000) {
  return new Promise((resolve) => {
    const done = (path) => {
      chrome.downloads.onChanged.removeListener(onChanged);
      clearTimeout(timer);
      resolve(path);
    };
    const onChanged = (delta) => delta.id === id && delta.filename?.current && done(delta.filename.current);
    const timer = setTimeout(() => done(null), timeoutMs);
    chrome.downloads.onChanged.addListener(onChanged);
    // The target may already be set before the listener was attached.
    chrome.downloads.search({ id }).then(([item]) => item?.filename && done(item.filename));
  });
}
