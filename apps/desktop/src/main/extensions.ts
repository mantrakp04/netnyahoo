import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, normalize, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  BrowserWindow,
  app,
  dialog,
  ipcMain,
  session,
  type Extension,
  type WebContents,
} from "electron";
import { unzipSync } from "fflate";
import {
  EXTENSIONS_INSTALL_UNPACKED_CHANNEL,
  EXTENSIONS_INSTALL_WEBSTORE_CHANNEL,
  EXTENSIONS_LIST_CHANNEL,
  EXTENSIONS_REMOVE_CHANNEL,
  WEBVIEW_PARTITION,
  type InstalledExtension,
} from "../shared/extensions";

interface SavedExtensions {
  paths: string[];
}

const savedExtensionsFile = "extensions.json";
const extensionIdPattern = /^[a-p]{32}$/;
const chromeWebStoreInstallProtocol = "netnyahoo-extension-install:";
const chromeWebStoreRequestFilter = {
  urls: [
    "https://chromewebstore.google.com/*",
    "https://clients2.google.com/*",
    "https://clients2.googleusercontent.com/*",
  ],
} satisfies Electron.WebRequestFilter;

export function registerExtensionSupport() {
  const manager = new ExtensionManager();

  ipcMain.handle(EXTENSIONS_LIST_CHANNEL, () => manager.list());
  ipcMain.handle(EXTENSIONS_INSTALL_UNPACKED_CHANNEL, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    return await manager.installUnpacked(win);
  });
  ipcMain.handle(EXTENSIONS_INSTALL_WEBSTORE_CHANNEL, async (_event, input) => {
    if (typeof input !== "string") {
      throw new Error("Chrome Web Store URL or extension id is required.");
    }
    await manager.installFromChromeWebStore(input);
    return manager.list();
  });
  ipcMain.handle(EXTENSIONS_REMOVE_CHANNEL, async (_event, id: unknown) => {
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("Extension id is required.");
    }
    await manager.remove(id);
    return manager.list();
  });
  registerChromeWebStoreUserAgentOverride();
  registerChromeWebStoreInstallButtons(manager);

  return manager;
}

export class ExtensionManager {
  private readonly extensionsSession = session.fromPartition(WEBVIEW_PARTITION);
  private readonly storagePath = join(app.getPath("userData"), savedExtensionsFile);
  private readonly managedExtensionsPath = join(app.getPath("userData"), "extensions");
  private readonly downloadCachePath = join(
    app.getPath("userData"),
    "extension-downloads",
  );

  async loadPersistedExtensions() {
    const saved = await this.readSavedExtensions();
    const loadedPaths: string[] = [];

    for (const path of saved.paths) {
      try {
        await this.extensionsSession.extensions.loadExtension(path, {
          allowFileAccess: true,
        });
        loadedPaths.push(path);
      } catch (error) {
        console.warn(`Failed to load extension at ${path}:`, error);
      }
    }

    if (loadedPaths.length !== saved.paths.length) {
      await this.writeSavedExtensions({ paths: loadedPaths });
    }

    return this.list();
  }

  async installFromChromeWebStore(input: string) {
    const id = getChromeWebStoreExtensionId(input);
    if (!id) {
      throw new Error("Enter a Chrome Web Store detail URL or a 32-character extension id.");
    }

    const unpackedPath = join(this.managedExtensionsPath, id);
    const crxPath = join(this.downloadCachePath, `${id}.crx`);
    const zipPath = join(this.downloadCachePath, `${id}.zip`);

    await mkdir(this.downloadCachePath, { recursive: true });
    await downloadChromeWebStoreCrx(id, crxPath);
    const zipPayload = await readCrxZipPayload(crxPath);
    await writeFile(zipPath, zipPayload);

    const existing =
      this.extensionsSession.extensions.getExtension(id) ??
      this.extensionsSession.extensions
        .getAllExtensions()
        .find((extension) => extension.path === unpackedPath);
    if (existing) {
      this.extensionsSession.extensions.removeExtension(existing.id);
    }

    await rm(unpackedPath, { recursive: true, force: true });
    await mkdir(unpackedPath, { recursive: true });
    await extractZipPayload(zipPayload, unpackedPath);

    const extension = await this.extensionsSession.extensions.loadExtension(
      unpackedPath,
      { allowFileAccess: true },
    );

    const saved = await this.readSavedExtensions();
    await this.writeSavedExtensions({
      paths: uniquePaths([
        ...saved.paths.filter((path) => path !== existing?.path),
        extension.path,
      ]),
    });

    return extension;
  }

  list(): InstalledExtension[] {
    return this.extensionsSession.extensions
      .getAllExtensions()
      .map(toInstalledExtension)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async installUnpacked(win: BrowserWindow | undefined) {
    const owner = win ?? BrowserWindow.getAllWindows()[0];
    const options = {
      title: "Install Unpacked Extension",
      buttonLabel: "Install Extension",
      properties: ["openDirectory"],
    } satisfies Electron.OpenDialogOptions;
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);

    if (result.canceled || result.filePaths.length === 0) {
      return this.list();
    }

    const path = result.filePaths[0];
    if (!path) return this.list();

    const existing = this.extensionsSession.extensions
      .getAllExtensions()
      .find((extension) => extension.path === path);

    if (!existing) {
      await this.extensionsSession.extensions.loadExtension(path, {
        allowFileAccess: true,
      });
    }

    const saved = await this.readSavedExtensions();
    await this.writeSavedExtensions({
      paths: uniquePaths([...saved.paths, path]),
    });

    return this.list();
  }

  async remove(id: string) {
    const extension = this.extensionsSession.extensions.getExtension(id);
    if (!extension) return;

    this.extensionsSession.extensions.removeExtension(id);

    const saved = await this.readSavedExtensions();
    await this.writeSavedExtensions({
      paths: saved.paths.filter((path) => path !== extension.path),
    });
  }

  private async readSavedExtensions(): Promise<SavedExtensions> {
    try {
      const raw = await readFile(this.storagePath, "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (!isSavedExtensions(parsed)) return { paths: [] };
      return { paths: uniquePaths(parsed.paths) };
    } catch (error) {
      if (isNotFoundError(error)) return { paths: [] };
      throw error;
    }
  }

  private async writeSavedExtensions(saved: SavedExtensions) {
    await mkdir(dirname(this.storagePath), { recursive: true });
    await writeFile(this.storagePath, `${JSON.stringify(saved, null, 2)}\n`);
  }
}

function registerChromeWebStoreInstallButtons(manager: ExtensionManager) {
  app.on("web-contents-created", (_event, contents) => {
    if (contents.getType() !== "webview") return;

    const inject = () => {
      if (contents.isDestroyed()) return;
      const id = getChromeWebStoreExtensionId(contents.getURL());
      if (!id) return;
      contents.setUserAgent(getChromeUserAgent());
      void contents.executeJavaScript(getChromeWebStoreInstallScript(id), true);
    };

    contents.on("dom-ready", inject);
    contents.on("did-finish-load", inject);
    contents.on("did-navigate-in-page", inject);
    contents.on("will-navigate", (event, url) => {
      const id = getInternalInstallExtensionId(url);
      if (!id) return;

      event.preventDefault();
      void installFromPatchedChromeWebStoreButton(contents, manager, id);
    });
  });
}

function registerChromeWebStoreUserAgentOverride() {
  session.fromPartition(WEBVIEW_PARTITION).webRequest.onBeforeSendHeaders(
    chromeWebStoreRequestFilter,
    (details, callback) => {
      const requestHeaders = {
        ...details.requestHeaders,
        "User-Agent": getChromeUserAgent(),
        "sec-ch-ua": getChromeBrandHeader(),
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": process.platform === "darwin" ? '"macOS"' : '"Windows"',
      };

      callback({ requestHeaders });
    },
  );
}

async function installFromPatchedChromeWebStoreButton(
  contents: WebContents,
  manager: ExtensionManager,
  id: string,
) {
  await setChromeWebStoreInstallButtonState(contents, "installing");

  try {
    await manager.installFromChromeWebStore(id);
    await setChromeWebStoreInstallButtonState(contents, "installed");
  } catch (error) {
    await setChromeWebStoreInstallButtonState(
      contents,
      "error",
      getErrorMessage(error),
    );
  }
}

function toInstalledExtension(extension: Extension): InstalledExtension {
  return {
    id: extension.id,
    name: extension.name,
    version: extension.version,
    path: extension.path,
    url: extension.url,
    description: getExtensionDescription(extension),
  };
}

function getExtensionDescription(extension: Extension) {
  const manifest: unknown = extension.manifest;
  if (!manifest || typeof manifest !== "object") return null;

  const description = (manifest as { description?: unknown }).description;
  return typeof description === "string" && description.trim().length > 0
    ? description
    : null;
}

function isSavedExtensions(value: unknown): value is SavedExtensions {
  return (
    !!value &&
    typeof value === "object" &&
    Array.isArray((value as SavedExtensions).paths) &&
    (value as SavedExtensions).paths.every((path) => typeof path === "string")
  );
}

function uniquePaths(paths: string[]) {
  return [...new Set(paths)];
}

function isNotFoundError(error: unknown) {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function getChromeWebStoreExtensionId(input: string) {
  const trimmed = input.trim();
  if (extensionIdPattern.test(trimmed)) return trimmed;

  try {
    const url = new URL(trimmed);
    const idFromQuery = url.searchParams.get("id");
    if (idFromQuery && extensionIdPattern.test(idFromQuery)) return idFromQuery;

    const pathSegments = url.pathname.split("/").filter(Boolean);
    const idFromPath = pathSegments.findLast((segment) =>
      extensionIdPattern.test(segment),
    );
    return idFromPath ?? null;
  } catch {
    return null;
  }
}

function getInternalInstallExtensionId(input: string) {
  try {
    const url = new URL(input);
    if (url.protocol !== chromeWebStoreInstallProtocol) return null;

    const id = url.hostname || url.pathname.replace(/^\/+/, "");
    return extensionIdPattern.test(id) ? id : null;
  } catch {
    return null;
  }
}

async function setChromeWebStoreInstallButtonState(
  contents: WebContents,
  state: "installing" | "installed" | "error",
  message?: string,
) {
  if (contents.isDestroyed()) return;
  await contents.executeJavaScript(
    `window.__netnyahooSetChromeWebStoreInstallState?.(${JSON.stringify(state)}, ${JSON.stringify(message ?? null)})`,
    true,
  );
}

function getChromeWebStoreInstallScript(id: string) {
  const installUrl = `${chromeWebStoreInstallProtocol}//${id}`;
  const chromeMajorVersion = process.versions.chrome.split(".")[0] ?? "120";
  return `
    (() => {
      const extensionId = ${JSON.stringify(id)};
      const installUrl = ${JSON.stringify(installUrl)};
      const chromeMajorVersion = ${JSON.stringify(chromeMajorVersion)};
      const targetText = /add\\s+to\\s+chrome/i;
      const patchedAttribute = "data-netnyahoo-extension-install";
      const statusAttribute = "data-netnyahoo-extension-install-status";

      const state = window.__netnyahooChromeWebStoreInstallState ?? {
        status: "idle",
        message: null,
      };
      window.__netnyahooChromeWebStoreInstallState = state;

      function installChromeDetectionHints() {
        const userAgentData = {
          brands: [
            { brand: "Google Chrome", version: chromeMajorVersion },
            { brand: "Chromium", version: chromeMajorVersion },
            { brand: "Not-A.Brand", version: "99" },
          ],
          mobile: false,
          platform: "macOS",
          getHighEntropyValues: async (hints) => {
            const values = {
              architecture: "arm",
              bitness: "64",
              brands: userAgentData.brands,
              fullVersionList: userAgentData.brands,
              mobile: false,
              model: "",
              platform: "macOS",
              platformVersion: "",
              uaFullVersion: chromeMajorVersion + ".0.0.0",
            };
            return Object.fromEntries(hints.map((hint) => [hint, values[hint]]));
          },
          toJSON: () => ({
            brands: userAgentData.brands,
            mobile: false,
            platform: "macOS",
          }),
        };

        try {
          Object.defineProperty(navigator, "userAgentData", {
            configurable: true,
            get: () => userAgentData,
          });
        } catch {
          // Chrome Web Store still works with the DOM patch below.
        }
      }

      installChromeDetectionHints();

      function labelForStatus() {
        if (state.status === "installing") return "Adding...";
        if (state.status === "installed") return "Added";
        if (state.status === "error") return "Try again";
        return "Add to Chrome";
      }

      function isInstallCandidate(element) {
        if (!(element instanceof HTMLElement)) return false;
        if (element.getAttribute(patchedAttribute) === extensionId) return true;

        const role = element.getAttribute("role");
        const looksClickable =
          element.tagName === "BUTTON" ||
          element.tagName === "A" ||
          role === "button";
        if (!looksClickable) return false;

        const text = [
          element.textContent,
          element.getAttribute("aria-label"),
          element.getAttribute("title"),
        ].filter(Boolean).join(" ");
        return targetText.test(text);
      }

      function setButtonText(element) {
        const nextLabel = labelForStatus();
        if (element.textContent !== nextLabel) element.textContent = nextLabel;
      }

      function setAttributeIfChanged(element, name, value) {
        if (element.getAttribute(name) !== value) {
          element.setAttribute(name, value);
        }
      }

      function patchButton(element) {
        setAttributeIfChanged(element, patchedAttribute, extensionId);
        setAttributeIfChanged(element, statusAttribute, state.status);
        setAttributeIfChanged(element, "aria-label", labelForStatus());
        setAttributeIfChanged(
          element,
          "aria-disabled",
          state.status !== "idle" ? "true" : "false",
        );
        element.removeAttribute("disabled");
        element.removeAttribute("data-disabled");
        element.tabIndex = 0;
        element.style.pointerEvents = "auto";
        element.style.cursor = state.status === "idle" ? "pointer" : "default";
        element.style.opacity = "1";
        setButtonText(element);
      }

      function patchButtons() {
        hideChromeSwitchPrompts();

        document
          .querySelectorAll("button, a, [role='button']")
          .forEach((element) => {
            if (isInstallCandidate(element)) patchButton(element);
          });
      }

      function hideChromeSwitchPrompts() {
        document
          .querySelectorAll("div, section, aside, [role='dialog']")
          .forEach((element) => {
          if (!(element instanceof HTMLElement)) return;
          const rect = element.getBoundingClientRect();
          const isBanner = rect.width > 320 && rect.height > 32 && rect.height < 140;
          const isCard = rect.width > 180 && rect.width < 520 && rect.height > 120 && rect.height < 360;
          if (!isBanner && !isCard) return;

          const text = element.textContent ?? "";
          if (
            !/switch\\s+to\\s+chrome/i.test(text) &&
            !/google\\s+recommends\\s+using\\s+chrome/i.test(text) &&
            !/install\\s+chrome/i.test(text)
          ) {
            return;
          }

          element.style.display = "none";
          element.setAttribute("aria-hidden", "true");
        });
      }

      function activate(event) {
        const target = event.target instanceof Element
          ? event.target.closest("[" + patchedAttribute + "='" + extensionId + "']")
          : null;
        if (!target || state.status !== "idle") return;

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        state.status = "installing";
        state.message = null;
        patchButtons();
        window.location.href = installUrl;
      }

      if (window.__netnyahooChromeWebStoreInstallClick) {
        document.removeEventListener("click", window.__netnyahooChromeWebStoreInstallClick, true);
      }
      if (window.__netnyahooChromeWebStoreInstallKeyDown) {
        document.removeEventListener("keydown", window.__netnyahooChromeWebStoreInstallKeyDown, true);
      }

      window.__netnyahooChromeWebStoreInstallClick = activate;
      window.__netnyahooChromeWebStoreInstallKeyDown = (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        activate(event);
      };
      window.__netnyahooSetChromeWebStoreInstallState = (nextStatus, message) => {
        state.status = nextStatus;
        state.message = message;
        patchButtons();
        if (message) console.warn("[netnyahoo] Extension install:", message);
      };

      document.addEventListener("click", window.__netnyahooChromeWebStoreInstallClick, true);
      document.addEventListener("keydown", window.__netnyahooChromeWebStoreInstallKeyDown, true);

      window.__netnyahooChromeWebStoreInstallObserver?.disconnect();
      window.__netnyahooChromeWebStoreInstallObserver = new MutationObserver(patchButtons);
      window.__netnyahooChromeWebStoreInstallObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
      });

      patchButtons();
    })();
  `;
}

async function downloadChromeWebStoreCrx(id: string, destination: string) {
  const url = new URL("https://clients2.google.com/service/update2/crx");
  url.searchParams.set("response", "redirect");
  url.searchParams.set("prodversion", process.versions.chrome);
  url.searchParams.set("acceptformat", "crx2,crx3");
  url.searchParams.set("x", `id=${id}&installsource=ondemand&uc`);

  const response = await fetch(url, {
    headers: {
      "user-agent": getChromeUserAgent(),
    },
  });

  if (!response.ok || !response.body) {
    throw new Error(
      `Chrome Web Store download failed (${response.status} ${response.statusText}).`,
    );
  }

  await pipeline(
    Readable.fromWeb(response.body as never),
    createWriteStream(destination),
  );
}

async function readCrxZipPayload(path: string) {
  const crx = await readFile(path);
  if (crx.subarray(0, 2).toString("utf8") === "PK") return crx;

  if (crx.subarray(0, 4).toString("utf8") !== "Cr24") {
    throw new Error("Downloaded extension is not a CRX file.");
  }

  const version = crx.readUInt32LE(4);
  if (version === 2) {
    const publicKeyLength = crx.readUInt32LE(8);
    const signatureLength = crx.readUInt32LE(12);
    return crx.subarray(16 + publicKeyLength + signatureLength);
  }
  if (version === 3) {
    const headerLength = crx.readUInt32LE(8);
    return crx.subarray(12 + headerLength);
  }

  throw new Error(`Unsupported CRX version: ${version}.`);
}

async function extractZipPayload(zipPayload: Buffer, destination: string) {
  const entries = unzipSync(new Uint8Array(zipPayload));
  const destinationRoot = normalize(destination + sep);

  for (const [name, data] of Object.entries(entries)) {
    if (name.endsWith("/")) continue;

    const outputPath = normalize(join(destination, name));
    if (!outputPath.startsWith(destinationRoot)) {
      throw new Error(`Extension archive contains an unsafe path: ${name}`);
    }

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, data);
  }
}

function getChromeUserAgent() {
  return [
    "Mozilla/5.0",
    "(Macintosh; Intel Mac OS X 10_15_7)",
    "AppleWebKit/537.36",
    "(KHTML, like Gecko)",
    `Chrome/${process.versions.chrome}`,
    "Safari/537.36",
  ].join(" ");
}

function getChromeBrandHeader() {
  const majorVersion = process.versions.chrome.split(".")[0] ?? "120";
  return `"Google Chrome";v="${majorVersion}", "Chromium";v="${majorVersion}", "Not-A.Brand";v="99"`;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Extension install failed.";
}
