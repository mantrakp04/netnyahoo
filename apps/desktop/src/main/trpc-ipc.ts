import type { IpcMainEvent } from "electron";
import { ipcMain } from "electron";
import type { AnyRouter, inferRouterContext } from "@trpc/server";
import {
  callProcedure,
  getErrorShape,
  getTRPCErrorFromUnknown,
  transformTRPCResponse,
  type ProcedureType,
} from "@trpc/server/unstable-core-do-not-import";

export const ELECTRON_TRPC_CHANNEL = "electron-trpc";

interface IpcOperation {
  id: number | string;
  type: ProcedureType;
  input: unknown;
  path: string;
}

interface RequestMessage {
  method: "request";
  operation: IpcOperation;
}

interface SubscriptionStopMessage {
  id: number | string;
  method: "subscription.stop";
}

type IpcMessage = RequestMessage | SubscriptionStopMessage;

interface CreateContextOptions {
  event: IpcMainEvent;
}

interface CreateIPCHandlerOptions<TRouter extends AnyRouter> {
  createContext?: (
    opts: CreateContextOptions,
  ) => inferRouterContext<TRouter> | Promise<inferRouterContext<TRouter>>;
  router: TRouter;
}

export function createIPCHandler<TRouter extends AnyRouter>({
  createContext,
  router,
}: CreateIPCHandlerOptions<TRouter>) {
  const listener = (event: IpcMainEvent, message: IpcMessage) => {
    void handleIPCMessage({ createContext, event, message, router });
  };

  ipcMain.on(ELECTRON_TRPC_CHANNEL, listener);

  return {
    dispose() {
      ipcMain.off(ELECTRON_TRPC_CHANNEL, listener);
    },
  };
}

async function handleIPCMessage<TRouter extends AnyRouter>({
  createContext,
  event,
  message,
  router,
}: {
  createContext?: (
    opts: CreateContextOptions,
  ) => inferRouterContext<TRouter> | Promise<inferRouterContext<TRouter>>;
  event: IpcMainEvent;
  message: IpcMessage;
  router: TRouter;
}) {
  if (message.method === "subscription.stop") return;

  const { id, input: serializedInput, path, type } = message.operation;
  const config = router._def._config;
  const input = config.transformer.input.deserialize(serializedInput);
  const ctx = await createContext?.({ event });

  try {
    const data = await callProcedure({
      batchIndex: 0,
      ctx,
      getRawInput: async () => input,
      path,
      router,
      signal: undefined,
      type,
    });

    reply(event, router, {
      id,
      result: { type: "data", data },
    });
  } catch (cause) {
    const error = getTRPCErrorFromUnknown(cause);
    const shape = getErrorShape({
      config,
      ctx,
      error,
      input,
      path,
      type,
    });

    reply(event, router, {
      id,
      error: shape,
    });
  }
}

function reply<TRouter extends AnyRouter>(
  event: IpcMainEvent,
  router: TRouter,
  response: Parameters<typeof transformTRPCResponse>[1],
) {
  if (event.sender.isDestroyed()) return;
  event.reply(
    ELECTRON_TRPC_CHANNEL,
    transformTRPCResponse(router._def._config, response),
  );
}
