
export type Props = Record<string, string | number | boolean | null>;
export interface PostHog {
  capture(event: string, props?: Props, options?: { send_instantly?: boolean }): void;
  conversations?: { isAvailable?(): boolean; show?(): void };
  onFeatureFlags?(
    callback: (flags: string[], variants: Record<string, string | boolean>, context?: { errorsLoading?: boolean }) => void,
  ): void;
  getFeatureFlag?(key: string): string | boolean | undefined;
}

export const ph = () => (window as Window & { posthog?: PostHog }).posthog;

export function track(event: string, props?: Props, options?: { send_instantly?: boolean }) {
  try {
    ph()?.capture(event, props, options);
  } catch {
  }
}
