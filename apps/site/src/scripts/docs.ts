// Docs: a small client-side filter over page titles and section headings,
// and "on this page" highlighting. No search index, no dependency.

const wrap = document.querySelector<HTMLElement>("[data-filter-wrap]");
const input = document.querySelector<HTMLInputElement>("[data-filter]");
const empty = document.querySelector<HTMLElement>("[data-filter-empty]");
const groups = [...document.querySelectorAll<HTMLElement>("[data-group]")];

if (wrap && input) {
  wrap.hidden = false;
  input.addEventListener("input", () => {
    const words = input.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
    let shown = 0;
    for (const group of groups) {
      let inGroup = 0;
      for (const item of group.querySelectorAll<HTMLElement>("[data-terms]")) {
        const terms = item.dataset.terms ?? "";
        const match = words.every((w) => terms.includes(w));
        item.hidden = !match;
        if (match) inGroup++;
      }
      group.hidden = inGroup === 0;
      shown += inGroup;
    }
    if (empty) empty.hidden = shown > 0;
  });
  // "/" focuses the filter, as on most documentation sites.
  document.addEventListener("keydown", (event) => {
    const target = event.target as HTMLElement | null;
    if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    const nav = input.closest("details");
    if (nav && !nav.open) nav.open = true;
    event.preventDefault();
    input.focus();
  });
}

// ---- On this page --------------------------------------------------------
const tocLinks = [...document.querySelectorAll<HTMLAnchorElement>("[data-toc] a")];
const targets = tocLinks
  .map((link) => document.getElementById(decodeURIComponent(link.hash.slice(1))))
  .filter((el): el is HTMLElement => el !== null);

if (targets.length > 0 && "IntersectionObserver" in window) {
  const visible = new Set<string>();
  const mark = () => {
    const firstVisible = targets.find((t) => visible.has(t.id));
    let current = firstVisible?.id;
    if (!current) {
      // Between headings: the last one scrolled past.
      const passed = targets.filter((t) => t.getBoundingClientRect().top < 120);
      current = passed[passed.length - 1]?.id ?? targets[0]?.id;
    }
    for (const link of tocLinks) {
      if (link.hash.slice(1) === current) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    }
  };
  const observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) visible.add(e.target.id);
        else visible.delete(e.target.id);
      }
      mark();
    },
    { rootMargin: "-80px 0px -55% 0px" }
  );
  for (const t of targets) observer.observe(t);
}
