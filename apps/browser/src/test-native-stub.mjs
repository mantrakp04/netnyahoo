export const docs = new Map();
export const readDocument = (name) => docs.get(name) ?? null;
export const writeDocument = (name, contents) => docs.set(name, contents);
// saveDocument lands at once, or, while heldSaves.on, when a test runs the queued releases.
export const heldSaves = { on: false, queue: [] };
export const saveDocument = (name, contents) =>
  new Promise((resolve) => {
    const land = () => (docs.set(name, contents), resolve());
    if (heldSaves.on) heldSaves.queue.push(land);
    else land();
  });
export const setZoom = () => Promise.resolve();
export const launchEnvironment = () => null;
export const appInfo = { appVersion: "1.0" };
export const systemInfo = () => ({ ...appInfo });
export const calendarAuthorization = () => "notDetermined";
export const requestCalendarAccess = () => Promise.resolve(false);
export const systemCalendars = () => Promise.resolve([]);
export const systemCalendarEvents = () => Promise.resolve([]);
export const onCalendarChanged = () => ({ remove() {} });
export const keychainGet = () => Promise.resolve(null);
export const keychainSet = () => Promise.resolve(true);
export const keychainDelete = () => Promise.resolve(true);
export const confirm = () => Promise.resolve({ confirmed: false, suppressed: false });
export const onWindowEvent = () => ({ remove() {} });
export const onAppEvent = () => ({ remove() {} });
export const postNotification = () => Promise.resolve(null);
export const removeNotifications = () => Promise.resolve();
export const fetchFavicon = () => Promise.resolve(null);
export const pruneFavicons = () => Promise.resolve();
export const hasDockSelection = false;
export const iconTheme = () => Promise.resolve(null);
export const cancelDownload = () => Promise.resolve();
export const deletedProfileData = [];
export const profileDataLeft = new Map();
export const deleteProfileData = (profile) => (deletedProfileData.push(profile), Promise.resolve(profileDataLeft.get(profile) ?? []));

// expo-modules-core: a test installs native modules on globalThis.nnTestNativeModules.
export const requireOptionalNativeModule = (name) => globalThis.nnTestNativeModules?.[name] ?? null;
export const requireNativeModule = () => ({});
// Saved passwords, one store per simulated device (sync tests).
export const passwordStores = new Map();
export const current = { device: null };
const logins = () => passwordStores.get(current.device);
export const savePassword = async (_profile, origin, username, password) => {
  logins().set(`${origin}\n${username}`, { origin: `${origin}/`, url: origin, username, password, created: Date.now() });
  return true;
};
export const deletePassword = async (_profile, origin, username) => (logins().delete(`${origin}\n${username}`), true);
export const readLogins = async () => [...logins().values()];
