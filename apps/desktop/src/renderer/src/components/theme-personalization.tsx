import { Palette, Check } from "lucide-react";
import type { CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  THEME_ACCENTS,
  type Theme,
  useTheme,
} from "@/hooks/use-theme";
import { cn } from "@/lib/utils";

const themeModes: ReadonlyArray<{ value: Theme; label: string }> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

export function ThemePersonalization() {
  const { theme, accent, setTheme, setAccent } = useTheme();
  const selectedAccent = THEME_ACCENTS.find((item) => item.value === accent)!;

  return (
    <Dialog>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Personalize theme"
              className="text-sidebar-foreground/80 size-6 shrink-0"
            >
              <Palette className="size-3.5" />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">Personalize theme</TooltipContent>
      </Tooltip>
      <DialogContent className="w-[min(31rem,calc(100vw-2rem))] max-w-none overflow-hidden border border-[color-mix(in_oklch,var(--foreground)_9%,transparent)] bg-[var(--theme-panel-surface)] p-0 shadow-[0_28px_80px_color-mix(in_oklch,var(--shadow-deep)_72%,transparent)] backdrop-blur-2xl sm:max-w-none">
        <div className="theme-personalization-stage relative flex min-h-40 items-center justify-center overflow-hidden">
          <div
            className="theme-personalization-crown"
            style={{ "--theme-swatch": selectedAccent.swatch } as CSSProperties}
          />
        </div>
        <div className="grid gap-4 px-5 pt-4 pb-5">
          <DialogHeader>
            <DialogTitle>Theme</DialogTitle>
          </DialogHeader>

          <div className="grid gap-2">
            <div className="text-muted-foreground text-[0.6875rem] font-medium tracking-wide uppercase">
              Mode
            </div>
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-[color-mix(in_oklch,var(--foreground)_6%,transparent)] p-1">
              {themeModes.map((mode) => (
                <Button
                  key={mode.value}
                  type="button"
                  variant={theme === mode.value ? "secondary" : "ghost"}
                  className={cn(
                    "h-8 rounded-md text-xs",
                    theme === mode.value &&
                      "bg-[var(--theme-mode-selected)] text-foreground shadow-[inset_0_1px_0_color-mix(in_oklch,white_28%,transparent)]",
                  )}
                  onClick={() => setTheme(mode.value)}
                >
                  {mode.label}
                </Button>
              ))}
            </div>
          </div>

          <Separator className="bg-[color-mix(in_oklch,var(--foreground)_8%,transparent)]" />

          <div className="grid gap-3">
            <div className="text-muted-foreground text-[0.6875rem] font-medium tracking-wide uppercase">
              Accent
            </div>
            <div className="grid grid-cols-8 gap-2">
              {THEME_ACCENTS.map((item) => (
                <AccentSwatch
                  key={item.value}
                  accent={item}
                  selected={accent === item.value}
                  onSelect={() => setAccent(item.value)}
                />
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AccentSwatch({
  accent,
  selected,
  onSelect,
}: {
  accent: (typeof THEME_ACCENTS)[number];
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`${accent.label} accent`}
          aria-pressed={selected}
          className={cn(
            "group relative aspect-square min-w-0 rounded-full outline-none transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring/55",
            selected && "ring-2 ring-[var(--theme-swatch)] ring-offset-2 ring-offset-popover",
          )}
          style={{ "--theme-swatch": accent.swatch } as CSSProperties}
          onClick={onSelect}
        >
          <span className="absolute inset-1 rounded-full bg-[var(--theme-swatch)] shadow-[inset_0_1px_0_color-mix(in_oklch,white_38%,transparent),0_8px_18px_color-mix(in_oklch,var(--theme-swatch)_34%,transparent)]" />
          {selected && (
            <span className="absolute inset-0 grid place-items-center rounded-full text-[color-mix(in_oklch,var(--theme-swatch)_18%,black_82%)]">
              <Check className="size-3.5" />
            </span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{accent.label}</TooltipContent>
    </Tooltip>
  );
}
