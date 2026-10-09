import { Cef } from "./native";

export const setZoom = (profile: string, host: string, zoom: number) => Cef.setZoom(profile, host, zoom);
export const getZoomLevels = (profile: string) => Cef.getZoomLevels(profile);
