import { ImportWindow } from "../import/ImportWindow";
import { TaskManagerWindow } from "../taskManager/TaskManagerWindow";
import { TASK_MANAGER_WINDOW_ID } from "../taskManager/window";
import { SettingsWindow } from "./SettingsWindow";
import { SETTINGS_WINDOW_ID } from "./windows";

/** The React root of a Settings or Import window (see windows.ts). */
export function UtilityWindow({ id }: { id: string }) {
  if (id === TASK_MANAGER_WINDOW_ID) return <TaskManagerWindow />;
  return id === SETTINGS_WINDOW_ID ? <SettingsWindow /> : <ImportWindow />;
}
