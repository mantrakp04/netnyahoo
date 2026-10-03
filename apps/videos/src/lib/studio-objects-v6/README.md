# Studio objects v6 runtime

v6 is the v5 runtime plus deletion. Everything in
`../studio-objects-v5/README.md` applies unchanged: the document format, the
readers, geometry, `geometryBetween`, text bindings, saves and Undo.

## What v6 adds

`StudioObjects` from v6 renders v5's provider with the same document, so a
component that still imports `useStudioObject` from v5 keeps working under it.
It also renders one `<style data-studio-runtime="6">`, after the video's own
children so no `:nth-child` position moves, that hides the bound root of every
removed object.

An object is removed when its record carries `"removed": true`, or when any of its
ancestors (through `parentId`) does. The Studio sets the flag when the person
deletes the object on the canvas and clears it on Undo:

```json
{ "id": "subtitle", "definition": "heading", "label": "Subtitle",
  "parentId": "opening", "removed": true, "values": { "text": "…" } }
```

A removed object:

- is not painted in the preview, in stills or in an export — its root, and
  everything drawn inside that root, has `display: none`;
- still answers every reader: `object.number(…)`, `object.text(…)` and the rest
  return its saved values, so timelines and cameras that read it keep working;
- keeps its ID reserved. Never reuse it for another object.

## Rules for code

- Import the provider from v6. Hooks may come from v5 or v6.
- Never render a removed object back: do not clear the flag, do not recreate
  the object under a new ID to show the same thing.
- When you next edit the scene that drew a removed object, delete its JSX. Delete
  its record too once nothing reads its values; otherwise leave the record.
- Do not author or rewrite the `remove` / `restore` entries in `operations`.
- Scenes are never removed; their place on the timeline lives in code.
