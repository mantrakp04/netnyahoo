import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const releaseNotes = defineCollection({
  loader: glob({
    pattern: "[0-9]*.md",
    base: "../../docs/release-notes",
    generateId: ({ entry }) => entry.replace(/\.md$/, ""),
  }),
  schema: z.object({
    date: z.coerce.date(),
    headline: z.string().min(1),
  }),
});

export const collections = { releaseNotes };
