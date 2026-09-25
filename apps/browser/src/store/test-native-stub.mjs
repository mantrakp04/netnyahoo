// In-memory stand-in for @netnyahoo/shell / @netnyahoo/cef in store tests.
export const docs = new Map();
export const readDocument = (name) => docs.get(name) ?? null;
export const writeDocument = (name, contents) => docs.set(name, contents);
export const setZoom = () => Promise.resolve();
// Live folders / Live Calendar (src/live) — inert stand-ins.
export const launchEnvironment = () => null;
// Release notes (components/ntp): tests set `appInfo.appVersion`.
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
// Favicons and downloads (lib/favicons, lib/persist).
export const fetchFavicon = () => Promise.resolve(null);
export const pruneFavicons = () => Promise.resolve();
export const hasDockSelection = false;
export const iconTheme = () => Promise.resolve(null);
export const cancelDownload = () => Promise.resolve();
