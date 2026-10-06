// Launch work the first window doesn't show (moving an old file's history or bookmarks into Chrome): it waits until
// the first window's content has committed (main.tsx), so the window doesn't wait for it, then runs in a task of its own.

// A launch whose window never commits (nothing to restore and none opened) runs the work after this long anyway.
const FALLBACK_MS = 5000;

let waiting: (() => void)[] | null = [];
let fallback: ReturnType<typeof setTimeout> | undefined;

function run(tasks: (() => void)[]) {
  for (const task of tasks) {
    try {
      task();
    } catch (error) {
      console.warn("[launch] deferred work failed", error);
    }
  }
}

/** Runs `task` once the launch's first window is up (at once, in a task of its own, when it already is). */
export function afterFirstWindow(task: () => void) {
  if (!waiting) {
    setTimeout(() => run([task]), 0);
    return;
  }
  waiting.push(task);
  fallback ??= setTimeout(firstWindowCommitted, FALLBACK_MS);
}

/** The first window's content has committed (main.tsx's root effect): the work waiting for it goes next. */
export function firstWindowCommitted() {
  if (!waiting) return;
  const tasks = waiting;
  waiting = null;
  clearTimeout(fallback);
  if (tasks.length) setTimeout(() => run(tasks), 0);
}
