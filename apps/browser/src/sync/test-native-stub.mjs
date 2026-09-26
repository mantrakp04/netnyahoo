// The store tests' native stand-ins, plus what sync needs: no native sync module, and a
// password store per test device behind @netnyahoo/cef's password calls.
export * from "../store/test-native-stub.mjs";
export const requireOptionalNativeModule = () => null;
export const requireNativeModule = () => ({});
/** Device id → Map("origin\nusername" → a login as the native reader returns it). */
export const passwordStores = new Map();
export const current = { device: null };
const logins = () => passwordStores.get(current.device);
export const savePassword = async (_profile, origin, username, password) => {
  logins().set(`${origin}\n${username}`, { origin: `${origin}/`, url: origin, username, password, created: Date.now() });
  return true;
};
export const deletePassword = async (_profile, origin, username) => (logins().delete(`${origin}\n${username}`), true);
export const readLogins = async () => [...logins().values()];
