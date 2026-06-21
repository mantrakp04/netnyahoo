import type { ReactNode } from "react";

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
    <div className="bg-card absolute inset-0 z-20 flex h-full flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-5">
        <span className="text-muted-foreground">{icon}</span>
        <h1 className="text-lg font-semibold">{title}</h1>
        <div className="ml-auto flex items-center gap-2">{actions}</div>
      </header>
      <div className="flex-1 overflow-y-auto">{children}</div>
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
    <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2">
      {icon}
      <p className="text-sm">{children}</p>
    </div>
  );
}
