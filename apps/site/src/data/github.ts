// GitHub stars, fetched once at build time. Shown next to the download only from 100 up: a small number
// reads as a warning, not proof. Fails soft: no network, a rate limit or a slow API gives null.
const MIN_SHOWN = 100;

async function fetchStars(): Promise<number | null> {
  try {
    const res = await fetch("https://api.github.com/repos/mantrakp04/netnyahoo", {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "netnyahoo-site-build" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const { stargazers_count } = (await res.json()) as { stargazers_count?: unknown };
    return typeof stargazers_count === "number" ? stargazers_count : null;
  } catch {
    return null;
  }
}

const stars = await fetchStars();

/** "1.2k", "340", or null when there are fewer than 100 stars or the count couldn't be fetched. */
export const STARS: string | null =
  stars === null || stars < MIN_SHOWN
    ? null
    : stars >= 1000
      ? `${(stars / 1000).toFixed(stars >= 10_000 ? 0 : 1).replace(/\.0$/, "")}k`
      : String(stars);
