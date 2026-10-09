import { Cef } from "./native";

// Calls into //chrome/browser/arcadia, the engine's own code over Chrome's stores (history, favicons, closed
// tabs). JSON in, JSON out; the native side allows only the calls it lists (ACEngineBridge.mm).
export async function engineCall<T>(name: string, profile: string, args?: object): Promise<T> {
  const result = JSON.parse(await Cef.engineCall(name, profile, args ? JSON.stringify(args) : null)) as T | { error: string };
  if (result && typeof result === "object" && "error" in result) throw new Error(`${name}: ${result.error}`);
  return result as T;
}

// The engine's change events ("<domain>.<what>"); `profile` is the app's engine profile ("" for the default one).
export const onEngineEvent = (listener: (topic: string, payload: { profile: string } & Record<string, unknown>) => void) =>
  Cef.addListener("onEngineEvent", (e) => listener(e.topic, JSON.parse(e.payload)));
