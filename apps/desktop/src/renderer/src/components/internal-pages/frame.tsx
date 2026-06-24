import type { ReactNode } from "react";
import { WebglGlow } from "@/components/webgl-glow";

const internalPageCardClass =
  "internal-page-card text-popover-foreground relative z-10 flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-[1.35rem] border border-[color-mix(in_oklch,var(--foreground)_8%,transparent)] bg-[var(--new-tab-card-surface)] shadow-[inset_0_1px_0_color-mix(in_oklch,white_20%,transparent)] backdrop-blur-[24px] backdrop-saturate-[1.08] dark:border-[color-mix(in_oklch,white_7%,transparent)] dark:shadow-[inset_0_1px_0_color-mix(in_oklch,white_4%,transparent)] dark:backdrop-blur-[26px] dark:backdrop-saturate-[1.06]";

export function InternalPageFrame({
  icon,
  title,
  actions,
  children,
}: {
  icon: ReactNode;
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="new-tab-page absolute inset-0 z-20 overflow-hidden bg-[var(--new-tab-scrim)] backdrop-blur-[22px] backdrop-saturate-[1.08] dark:backdrop-blur-[30px]">
      <WebglGlow variant="new-tab" />
      <div className="relative z-[1] mx-auto flex h-full w-full max-w-5xl flex-col px-6 py-6">
        <section className={internalPageCardClass}>
          <header className="flex min-h-14 shrink-0 items-center gap-3 border-b border-[color-mix(in_oklch,var(--foreground)_8%,transparent)] px-5">
            <span className="text-muted-foreground">{icon}</span>
            <h1 className="text-lg font-semibold">{title}</h1>
            <div className="ml-auto flex items-center gap-2">{actions}</div>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </section>
      </div>
    </div>
  );
}

export function EmptyState({
  icon,
  children,
}: {
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="text-muted-foreground flex min-h-full flex-col items-center justify-center gap-2 p-6">
      {icon}
      <p className="text-sm">{children}</p>
    </div>
  );
}
