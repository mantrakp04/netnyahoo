import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { type Theme, useTheme } from "@/hooks/use-theme";

const ORDER: Theme[] = ["light", "dark", "system"];

const META: Record<Theme, { icon: typeof Sun; label: string }> = {
  light: { icon: Sun, label: "Light" },
  dark: { icon: Moon, label: "Dark" },
  system: { icon: Monitor, label: "System" },
};

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const Icon = META[theme].icon;
  const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length]!;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground size-8 shrink-0"
          onClick={() => setTheme(next)}
          aria-label={`Theme: ${META[theme].label}. Switch to ${META[next].label}.`}
        >
          <Icon className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">
        Theme: {META[theme].label} — click for {META[next].label}
      </TooltipContent>
    </Tooltip>
  );
}
