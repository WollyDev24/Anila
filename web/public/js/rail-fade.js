const RAIL_SEL = ".rail";
const EDGE = 2;

const hasResizeObserver = typeof window.ResizeObserver === "function";

function update(rail) {
  const max = rail.scrollWidth - rail.clientWidth;
  const scrollable = max > EDGE;
  rail.classList.toggle("fade-left", scrollable && rail.scrollLeft > EDGE);
  rail.classList.toggle("fade-right", scrollable && max - rail.scrollLeft > EDGE);
}

const resizeObserver = hasResizeObserver
  ? new window.ResizeObserver((entries) => {
      for (const entry of entries) update(entry.target);
    })
  : null;

function observe(rail) {
  if (rail.__anilaRailObserved) return;
  rail.__anilaRailObserved = true;
  rail.addEventListener("scroll", () => update(rail), { passive: true });
  resizeObserver?.observe(rail);
  update(rail);
}

function scan(root) {
  if (!root || root.nodeType !== 1) return;
  if (root.matches?.(RAIL_SEL)) observe(root);
  root.querySelectorAll?.(RAIL_SEL).forEach(observe);
}

export function initRailFades() {
  scan(document.body);
  if (typeof window.MutationObserver === "function") {
    new window.MutationObserver((mutations) => {
      for (const mutation of mutations) mutation.addedNodes.forEach(scan);
    }).observe(document.body, { childList: true, subtree: true });
  }
  window.addEventListener("resize", () => {
    document.querySelectorAll(RAIL_SEL).forEach(update);
  });
}
