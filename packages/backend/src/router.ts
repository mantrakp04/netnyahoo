import { bookmarksRouter } from "./routers/bookmarks";
import { historyRouter } from "./routers/history";
import { spacesRouter } from "./routers/spaces";
import { tabsRouter } from "./routers/tabs";
import { router } from "./trpc";

export const appRouter = router({
  spaces: spacesRouter,
  tabs: tabsRouter,
  history: historyRouter,
  bookmarks: bookmarksRouter,
});

export type AppRouter = typeof appRouter;
