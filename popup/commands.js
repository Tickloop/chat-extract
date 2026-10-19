// MARK: Command blocks
// Each block is cloned from the popup's #cmd-tpl.

/** @param {{label: string, command: string}[]} commands */
export function renderCommands(container, commands) {
  container.replaceChildren(
    ...commands.map(({ label, command }, i) => {
      const block = document.getElementById("cmd-tpl").content.cloneNode(true);
      const pre = block.querySelector("pre");
      pre.id = `${container.id}-${i}`;
      pre.textContent = command;
      block.querySelector(".cmd-label").textContent = label;
      block.querySelector("[data-copy]").dataset.copy = pre.id;
      return block;
    }),
  );
}

// Delegated because command blocks are rendered after init.
export function wireCopyButtons() {
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-copy]");
    if (!btn?.dataset.copy) return;
    await navigator.clipboard.writeText(document.getElementById(btn.dataset.copy).textContent);
    btn.textContent = "Copied";
    setTimeout(() => (btn.textContent = "Copy"), 1200);
  });
}
