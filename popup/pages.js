// MARK: Page stack
// Pages are stacked in one grid cell (see popup.css): pushing a page slides it in from the right
// over the current one, popping slides it back out. Overlap order follows DOM order, so later
// pages in popup.html must be the ones pushed on top. Only the top page is interactive, and the
// viewport follows its height so the popup resizes with whatever page is showing.

export function createPageStack(viewport, rootId, { onChange = () => {} } = {}) {
  const pages = [...viewport.querySelectorAll(".page")];
  const stack = [rootId];
  const top = () => stack.at(-1);

  // The popup window resizes with the viewport, so height changes are discrete, never animated:
  // grow to fit both pages before a slide, then settle on the new page's height once it ends.
  const SLIDE_MS = 250; // just past the 200ms CSS slide, so the shrink never clips a moving page
  let settleTimer = null;
  const activeHeight = () => document.getElementById(top()).offsetHeight;
  const setHeight = (px) => (viewport.style.height = `${px}px`);

  function fitHeight() {
    if (settleTimer === null) setHeight(activeHeight());
  }

  function slideHeight() {
    clearTimeout(settleTimer);
    setHeight(Math.max(viewport.offsetHeight, activeHeight()));
    settleTimer = setTimeout(() => {
      settleTimer = null;
      fitHeight();
    }, SLIDE_MS);
  }

  function sync({ animate = true } = {}) {
    // Set in the same task as the stack change, so that change is the one that skips the slide.
    viewport.classList.toggle("instant", !animate);
    for (const page of pages) {
      const i = stack.indexOf(page.id);
      page.classList.toggle("in-stack", i !== -1);
      page.inert = page.id !== top();
    }
    if (animate) slideHeight();
    else fitHeight();
    onChange(top());
  }

  // Pages change height when their content does (status text, rendered commands).
  const observer = new ResizeObserver(fitHeight);
  pages.forEach((p) => observer.observe(p));
  sync({ animate: false });

  return {
    top,
    push(id, { animate = true } = {}) {
      if (top() === id) return;
      const existing = stack.indexOf(id);
      if (existing !== -1) stack.splice(existing, 1);
      stack.push(id);
      sync({ animate });
    },
    pop() {
      if (stack.length > 1) stack.pop();
      sync();
    },
  };
}
