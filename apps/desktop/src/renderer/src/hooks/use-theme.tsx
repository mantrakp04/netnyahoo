import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type Theme = "light" | "dark" | "system";
export type ThemeAccent =
  | "pearl"
  | "jade"
  | "cyan"
  | "violet"
  | "amber"
  | "maroon"
  | "red"
  | "orange";

export const THEME_STORAGE_KEY = "netnyahoo-theme";
export const THEME_ACCENT_STORAGE_KEY = "netnyahoo-theme-accent";

export const THEME_ACCENTS: ReadonlyArray<{
  value: ThemeAccent;
  label: string;
  swatch: string;
}> = [
  { value: "pearl", label: "Pearl", swatch: "#f7f7f5" },
  { value: "jade", label: "Jade", swatch: "#009966" },
  { value: "cyan", label: "Cyan", swatch: "#118bc1" },
  { value: "violet", label: "Violet", swatch: "#6860b8" },
  { value: "amber", label: "Amber", swatch: "#dc8a00" },
  { value: "maroon", label: "Maroon", swatch: "#b34863" },
  { value: "red", label: "Red", swatch: "#e43e55" },
  { value: "orange", label: "Orange", swatch: "#e94a0a" },
] as const;

interface ThemeContextValue {
  /** The user's choice, including "system". */
  theme: Theme;
  /** The user's accent color choice for the browser chrome. */
  accent: ThemeAccent;
  /** What's actually applied right now ("system" resolved against the OS). */
  resolvedTheme: "light" | "dark";
  setTheme: (theme: Theme) => void;
  setAccent: (accent: ThemeAccent) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemPrefersDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolve(theme: Theme): "light" | "dark" {
  if (theme === "system") return systemPrefersDark() ? "dark" : "light";
  return theme;
}

/** Mirror the resolved theme onto <html> so the CSS `.dark` variant applies. */
function apply(resolved: "light" | "dark", accent: ThemeAccent) {
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.dataset.accent = accent;
  root.style.colorScheme = resolved;
}

function readStored(): Theme {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "light" || stored === "dark" || stored === "system"
    ? stored
    : "system";
}

function isThemeAccent(value: string | null): value is ThemeAccent {
  return THEME_ACCENTS.some((accent) => accent.value === value);
}

function readStoredAccent(): ThemeAccent {
  const stored = localStorage.getItem(THEME_ACCENT_STORAGE_KEY);
  if (stored === "rose") return "maroon";
  return isThemeAccent(stored) ? stored : "jade";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() =>
    typeof window === "undefined" ? "system" : readStored(),
  );
  const [accent, setAccentState] = useState<ThemeAccent>(() =>
    typeof window === "undefined" ? "jade" : readStoredAccent(),
  );
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">(() =>
    typeof window === "undefined" ? "dark" : resolve(theme),
  );

  const setTheme = useCallback((next: Theme) => {
    localStorage.setItem(THEME_STORAGE_KEY, next);
    setThemeState(next);
    const resolved = resolve(next);
    setResolvedTheme(resolved);
    apply(resolved, accent);
  }, [accent]);

  const setAccent = useCallback(
    (next: ThemeAccent) => {
      localStorage.setItem(THEME_ACCENT_STORAGE_KEY, next);
      setAccentState(next);
      apply(resolvedTheme, next);
    },
    [resolvedTheme],
  );

  // Re-apply on mount and follow OS changes while in "system" mode.
  useEffect(() => {
    const resolved = resolve(theme);
    setResolvedTheme(resolved);
    apply(resolved, accent);

    if (theme !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const next = systemPrefersDark() ? "dark" : "light";
      setResolvedTheme(next);
      apply(next, accent);
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [accent, theme]);

  const value = useMemo(
    () => ({ theme, accent, resolvedTheme, setTheme, setAccent }),
    [theme, accent, resolvedTheme, setTheme, setAccent],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
