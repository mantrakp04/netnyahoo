import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { getInternalPageUrlForInput } from "@/lib/internal-pages";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Turn a raw omnibox entry into a navigable URL (or a Google search). */
export function toUrl(input: string): string {
  const value = input.trim();
  if (!value) return "about:blank";
  const internalPageUrl = getInternalPageUrlForInput(value);
  if (internalPageUrl) return internalPageUrl;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value;
  if (value.startsWith("about:")) return value;
  // Looks like a domain (has a dot, no spaces) → treat as URL.
  if (/^[^\s]+\.[^\s]+$/.test(value) && !value.includes(" ")) {
    return `https://${value}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
}

export function prettyUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "") + (u.pathname === "/" ? "" : u.pathname);
  } catch {
    return url;
  }
}
