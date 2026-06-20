import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useBrowser } from "@/hooks/use-browser";

export const Route = createFileRoute("/bookmarks")({
  component: BookmarksRoute,
});

function BookmarksRoute() {
  const navigate = useNavigate();
  const { openInternalPage } = useBrowser();

  useEffect(() => {
    openInternalPage("bookmarks");
    void navigate({ to: "/", replace: true });
  }, [navigate, openInternalPage]);

  return null;
}
