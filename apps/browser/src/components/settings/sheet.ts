import type { ReactNode } from "react";
import { create } from "zustand";

export const useSettingsSheet = create<{ sheet: ReactNode | null }>(() => ({ sheet: null }));
export const showSettingsSheet = (sheet: ReactNode) => useSettingsSheet.setState({ sheet });
export const closeSettingsSheet = () => useSettingsSheet.setState({ sheet: null });
