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
// The final path can differ from what we asked for (custom Downloads dir, " (1)" uniquify),
// and Chrome only fills it in once the target is determined, so poll briefly.

async function savedPath(id, attempts = 20) {
  for (let i = 0; i < attempts; i++) {
    const [item] = await chrome.downloads.search({ id });
    if (item?.filename) return item.filename;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}
