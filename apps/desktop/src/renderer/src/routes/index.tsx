import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  // The browser viewport (webviews) lives in the root layout and is always
  // mounted; the index route renders nothing on top of it.
  component: () => null,
});
