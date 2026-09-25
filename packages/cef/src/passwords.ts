import { Cef, valueOr } from "./native";

/** A saved login (the password itself is only returned by `getPassword`). */
export type SavedPassword = { origin: string; username: string; created: number; modified: number };

/**
 * Saved passwords are Chrome's password manager's, per profile (incognito uses
 * the default profile's). Chrome offers to save, fills and generates passwords
 * in pages itself; these are for the Passwords settings pane and imports.
 */
export const listPasswords = async (profile: string): Promise<SavedPassword[]> =>
  valueOr(await Cef.listPasswords(profile), { passwords: [] }).passwords;
/**
 * Touch ID / the login password through Chrome's own check, which revealing a password
 * needs anyway: unlocking with it means one prompt, and reveals pass for 5 minutes.
 * Resolves false if the user cancelled. `null`: this app build can't (use your own check).
 */
export const unlockPasswords = async (profile: string): Promise<boolean | null> => {
  if (!Cef.unlockPasswords) return null;
  return valueOr(await Cef.unlockPasswords(profile), { unlocked: false }).unlocked;
};
/** Reveals a saved password (for a Passwords settings pane). */
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
/**
 * "Never for this site" is set from Chrome's save prompt; this can only take a
 * site off that list (`never` false).
 */
export const setNeverSavePasswords = async (profile: string, origin: string, never: boolean) => {
  if (!never) valueOr(await Cef.allowSavingPasswords(profile, origin), null);
};
export const getNeverSavePasswordOrigins = async (profile: string) =>
  valueOr(await Cef.getNeverSavePasswordOrigins(profile), { origins: [] }).origins;
/** A strong password like Safari's ("abcdef-GHIjk2-lmnopq"). */
export const generatePassword = () => Cef.generatePassword();
/** Chrome offers to save and fills passwords (default on). */
export const getPasswordAutofill = (profile = "") => Cef.getPasswordAutofill(profile);
export const setPasswordAutofill = (enabled: boolean, profile = "") => Cef.setPasswordAutofill(profile, enabled);
