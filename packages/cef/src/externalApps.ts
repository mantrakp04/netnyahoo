import { Cef } from "./native";

// A link to another app (codex:, zoommtg:, mailto:…). `app` is null when no app on this Mac opens
// it; `remember` is the "always allow" label, null when the choice can't be kept (private windows,
// insecure or opaque origins). The wording comes from native so the popover and the popup sheet match.
export type ExternalAppRequest = {
  id: string;
  url: string;
  scheme: string;
  origin: string | null;
  app: string | null;
  appPath: string | null;
  icon: string | null;
  title: string;
  message: string | null;
  remember: string | null;
};

export type ExternalAppAllowance = { origin: string; scheme: string; app: string | null; icon: string | null };

export const resolveExternalApp = (id: string, open: boolean, remember = false) => Cef.resolveExternalApp(id, open, remember);
export const getExternalAppAllowances = (profile: string) => Cef.getExternalAppAllowances(profile);
export const removeExternalAppAllowance = (profile: string, origin: string, scheme: string) =>
  Cef.removeExternalAppAllowance(profile, origin, scheme);
