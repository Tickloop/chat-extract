// MARK: Run in tab
// Frontends' page functions run in the MAIN world so they can use the site's own session.

export async function runInTab(tabId, func, args = []) {
  const [{ result, error } = {}] = await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func, args });
  // A throw in the page rejects, comes back as `error`, or (Brave 155) is dropped to a null result,
  // depending on the browser; so page functions report failures as {pageError} instead.
  if (result?.pageError) throw new Error(result.pageError);
  if (error) throw new Error(error.message ?? String(error));
  if (!result) throw new Error("Could not read the conversation from this page.");
  return result;
}
