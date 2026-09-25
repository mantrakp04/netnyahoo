import type { ReactNode } from "react";
import { create } from "zustand";

/** A sheet over the whole Settings window (Clear Browsing Data, filter lists, password details…). */
export const useSettingsSheet = create<{ sheet: ReactNode | null }>(() => ({ sheet: null }));
export const showSettingsSheet = (sheet: ReactNode) => useSettingsSheet.setState({ sheet });
export const closeSettingsSheet = () => useSettingsSheet.setState({ sheet: null });
