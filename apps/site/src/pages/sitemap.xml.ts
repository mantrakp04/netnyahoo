import type { APIRoute } from "astro";
import { getCollection } from "astro:content";

export const GET: APIRoute = async ({ site }) => {
  const home = new URL(import.meta.env.BASE_URL, site);
  // Both pages change with each release: its notes' date is their last change.
  const notes = await getCollection("releaseNotes");
  const lastmod = notes.map((n) => n.data.date.toISOString().slice(0, 10)).sort().at(-1);
  const urls = ["", "release-notes/"].map(
    (path) => `  <url><loc>${new URL(path, home)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`,
  );
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`,
    { headers: { "Content-Type": "application/xml; charset=utf-8" } },
  );
};
