import { requireOptionalNativeModule } from "expo-modules-core";
import type { Listing, Transport } from "./scope.ts";

export type FolderInfo = {
  path: string;
  /** iCloud Drive › Netnyahoo Sync (a throwaway folder in test instances). */
  defaultPath: string;
  iCloudAvailable: boolean;
  inICloud: boolean;
  exists: boolean;
  writable: boolean;
  /** Someone's sync data is there already (maybe this phrase's, maybe another). */
  hasSyncData: boolean;
};

export type PhraseResult =
  | { ok: true }
  | { error: "wordCount"; count: number }
  | { error: "unknownWord"; word: string }
  | { error: "checksum" }
  | { error: "noData" }
  | { error: "mismatch" }
  | { error: "keychain" };

export type SavedLogin = { origin: string; url: string; username: string; password: string; created: number };

type SyncNative = {
  folderInfo(path: string | null): Promise<FolderInfo>;
  chooseFolder(current: string | null): Promise<string | null>;
  newDeviceId(): string;
  deviceName(): string;
  createPhrase(account: string): Promise<boolean>;
  enterPhrase(account: string, text: string, folder: string): Promise<PhraseResult>;
  unlock(account: string): Promise<boolean>;
  forget(account: string): Promise<void>;
  chainStatus(folder: string): Promise<"ok" | "missing" | "unavailable">;
  createChain(folder: string): Promise<void>;
  write(folder: string, scope: string, payload: string): Promise<string>;
  read(folder: string, scope: string, known: string[]): Promise<Listing>;
  remove(folder: string, scope: string, ids: string[]): Promise<void>;
  deleteChain(folder: string): Promise<void>;
  sealLocal(text: string): Promise<string>;
  openLocal(sealed: string): Promise<string | null>;
  recoveryWords(): Promise<string[]>;
  qrCode(): Promise<string | null>;
  recoveryKitPreview(width: number): Promise<string | null>;
  saveRecoveryKit(format: "pdf" | "text"): Promise<string | null>;
  copyRecoveryKit(): Promise<void>;
  shareRecoveryKit(): Promise<void>;
  copyRecoveryPhrase(): Promise<void>;
  revealFolder(path: string): Promise<void>;
  readPasswords(engineProfile: string): Promise<SavedLogin[] | null>;
};

/**
 * The native side, or null in a build without it (Metro serves this JS to instances built
 * before the module existed).
 */
export const SyncNative = requireOptionalNativeModule<SyncNative>("NetnyahooSync");

/** The sync folder as a Transport for syncScope. */
export const folderTransport = (native: SyncNative, folder: string): Transport => ({
  write: (scope, payload) => native.write(folder, scope, payload),
  read: (scope, known) => native.read(folder, scope, known),
  remove: (scope, ids) => native.remove(folder, scope, ids),
});
