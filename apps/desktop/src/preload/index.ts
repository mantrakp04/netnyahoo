import { exposeElectronTRPC } from "./trpc-ipc";

process.once("loaded", () => {
  exposeElectronTRPC();
});
