export const WEBVIEW_PARTITION = "persist:netnyahoo";

export const EXTENSIONS_LIST_CHANNEL = "extensions:list";
export const EXTENSIONS_INSTALL_UNPACKED_CHANNEL = "extensions:install-unpacked";
export const EXTENSIONS_INSTALL_WEBSTORE_CHANNEL = "extensions:install-webstore";
export const EXTENSIONS_REMOVE_CHANNEL = "extensions:remove";

export interface InstalledExtension {
  id: string;
  name: string;
  version: string;
  path: string;
  url: string;
  description: string | null;
}
