import type { TRPCLink } from "@trpc/client";
import { TRPCClientError } from "@trpc/client";
import { getTransformer } from "@trpc/client/unstable-internals";
import type { AnyRouter } from "@trpc/server";
import { observable } from "@trpc/server/observable";

interface ElectronTRPCBridge {
  sendMessage: (message: unknown) => void;
  onMessage: (callback: (message: IpcResponseMessage) => void) => () => void;
}

interface IpcResponseMessage {
  id: number | string;
  result?: {
    type?: "data" | "started" | "stopped";
    data?: unknown;
  };
  error?: unknown;
}

export function ipcLink<TRouter extends AnyRouter>(): TRPCLink<TRouter> {
  const transformer = getTransformer(undefined);

  return () =>
    ({ op }) =>
      observable((observer) => {
        const bridge = getElectronTRPCBridge();
        const unsubscribe = bridge.onMessage((message) => {
          if (message.id !== op.id) return;

          if (message.error) {
            observer.error(
              TRPCClientError.from({
                id: message.id,
                error: transformer.output.deserialize(message.error),
              }),
            );
            unsubscribe();
            return;
          }

          observer.next({
            result: {
              ...message.result,
              data: transformer.output.deserialize(message.result?.data),
            },
          });

          if (op.type !== "subscription") {
            observer.complete();
            unsubscribe();
          }
        });

        bridge.sendMessage({
          method: "request",
          operation: {
            ...op,
            input: transformer.input.serialize(op.input),
          },
        });

        return () => {
          unsubscribe();
          if (op.type === "subscription") {
            bridge.sendMessage({ id: op.id, method: "subscription.stop" });
          }
        };
      });
}

function getElectronTRPCBridge(): ElectronTRPCBridge {
  const bridge = window.electronTRPC;
  if (!bridge) {
    throw new Error("Missing electronTRPC preload bridge.");
  }
  return bridge as ElectronTRPCBridge;
}
