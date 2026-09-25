import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

// One Markdown file per version in the repo's docs/release-notes/ (docs/release-notes/README.md is the
// style guide). The same file becomes the GitHub release's notes and the updater's (scripts/release.sh).
const releaseNotes = defineCollection({
  loader: glob({
    pattern: "[0-9]*.md",
    base: "../../docs/release-notes",
    // The file name is the version; the default id would slugify "0.1.4" to "014".
    generateId: ({ entry }) => entry.replace(/\.md$/, ""),
  }),
  schema: z.object({
    date: z.coerce.date(),
    headline: z.string().min(1),
  }),
});

export const collections = { releaseNotes };
