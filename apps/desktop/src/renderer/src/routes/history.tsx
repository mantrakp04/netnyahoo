import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useBrowser } from "@/hooks/use-browser";

export const Route = createFileRoute("/history")({
  component: HistoryRoute,
});

function HistoryRoute() {
  const navigate = useNavigate();
  const { openInternalPage } = useBrowser();

  useEffect(() => {
    openInternalPage("history");
    void navigate({ to: "/", replace: true });
  }, [navigate, openInternalPage]);

  return null;
}
