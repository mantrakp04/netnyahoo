import { Cef, valueOr } from "./native";

export type SavedPassword = { origin: string; username: string; created: number; modified: number };

export const listPasswords = async (profile: string): Promise<SavedPassword[]> =>
  valueOr(await Cef.listPasswords(profile), { passwords: [] }).passwords;
export const unlockPasswords = async (profile: string): Promise<boolean> =>
  valueOr(await Cef.unlockPasswords(profile), { unlocked: false }).unlocked;
export const getPassword = async (profile: string, origin: string, username: string) =>
  valueOr(await Cef.getPassword(profile, origin, username), { password: null }).password;
export const savePassword = async (profile: string, origin: string, username: string, password: string) =>
  valueOr(await Cef.savePassword(profile, origin, username, password), null) !== null;
export const updatePassword = async (
  profile: string,
  origin: string,
  username: string,
  changes: { username?: string; password?: string },
) => valueOr(await Cef.updatePassword(profile, origin, username, changes.username ?? null, changes.password ?? null), null) !== null;
export const deletePassword = async (profile: string, origin: string, username: string) =>
  valueOr(await Cef.deletePassword(profile, origin, username), null) !== null;
export const setNeverSavePasswords = async (profile: string, origin: string, never: boolean) => {
  if (!never) valueOr(await Cef.allowSavingPasswords(profile, origin), null);
};
export const getNeverSavePasswordOrigins = async (profile: string) =>
  valueOr(await Cef.getNeverSavePasswordOrigins(profile), { origins: [] }).origins;
export const getPasswordAutofill = (profile = "") => Cef.getPasswordAutofill(profile);
export const setPasswordAutofill = (enabled: boolean, profile = "") => Cef.setPasswordAutofill(profile, enabled);
