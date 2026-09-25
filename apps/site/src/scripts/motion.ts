// Scroll reveals. CSS does the motion (and skips it under reduced motion); this only flips `.in`.
const reveal = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add("in");
      reveal.unobserve(e.target);
    }
  },
  { threshold: 0 },
);
for (const el of document.querySelectorAll("[data-reveal]")) reveal.observe(el);
