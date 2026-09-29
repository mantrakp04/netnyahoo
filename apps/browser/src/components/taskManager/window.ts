import { openWindow } from "@netnyahoo/shell";

export const TASK_MANAGER_WINDOW_ID = "task-manager";

export function openTaskManager() {
  void openWindow(TASK_MANAGER_WINDOW_ID, { kind: "taskManager", title: "Task Manager" });
}
