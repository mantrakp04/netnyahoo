export * from "../store/test-native-stub.mjs";
export const requireOptionalNativeModule = (name) => globalThis.nnTestNativeModules?.[name] ?? null;
export const requireNativeModule = () => ({});
export const passwordStores = new Map();
export const current = { device: null };
const logins = () => passwordStores.get(current.device);
export const savePassword = async (_profile, origin, username, password) => {
  logins().set(`${origin}\n${username}`, { origin: `${origin}/`, url: origin, username, password, created: Date.now() });
  return true;
};
export const deletePassword = async (_profile, origin, username) => (logins().delete(`${origin}\n${username}`), true);
export const readLogins = async () => [...logins().values()];
