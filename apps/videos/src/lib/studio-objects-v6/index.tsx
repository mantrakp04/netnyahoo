import { type ComponentProps, type ReactNode, useMemo } from "react";
import {
  StudioObjects as ObjectsV5,
  useStudioObject as useStudioObjectV5,
} from "../studio-objects-v5";

export const useStudioObject = useStudioObjectV5;

type ObjectDocument = ComponentProps<typeof ObjectsV5>["document"];

interface Removable {
  readonly id: string;
  readonly parentId: string | null;
  readonly removed?: unknown;
}

function removedIds(objects: readonly Removable[]): string[] {
  const byId = new Map(objects.map((item) => [item.id, item]));
  return objects
    .filter((item) => {
      const visited = new Set<string>();
      let current: Removable | undefined = item;
      while (current !== undefined && !visited.has(current.id)) {
        if (current.removed === true) {
          return true;
        }
        visited.add(current.id);
        current =
          current.parentId === null ? undefined : byId.get(current.parentId);
      }
      return false;
    })
    .map((item) => item.id);
}

export function hiddenRule(document: ObjectDocument): string {
  return removedIds(document.objects)
    .map((id) => `[data-studio-object="${id}"]{display:none!important}`)
    .join("\n");
}

export function StudioObjects({
  document,
  children,
}: {
  document: ObjectDocument;
  children: ReactNode;
}) {
  const rule = useMemo(() => hiddenRule(document), [document]);
  return (
    <ObjectsV5 document={document}>
      {children}
      <style data-studio-runtime="6">{rule}</style>
    </ObjectsV5>
  );
}
