import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { continueRender, delayRender } from "remotion";

// One or more lines (split on \n), the whole block scaled down so the widest line fits `width`.
// Measured from the DOM once the fonts are in, so it follows the real font.
export const Fit: React.FC<{ text: string; width: number; style: React.CSSProperties }> = ({ text, width, style }) => {
  const ref = useRef<HTMLDivElement>(null);
  const kRef = useRef(1);
  const [k, setK] = useState(1);
  const [handle] = useState(() => delayRender("Fitting a headline"));
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const natural = Math.max(...Array.from(el.children).map((c) => (c as HTMLElement).offsetWidth)) / kRef.current;
    kRef.current = Math.min(1, width / natural);
    setK(kRef.current);
  }, [width]);
  useLayoutEffect(measure, [measure, text, style.fontSize]);
  useEffect(() => {
    document.fonts.ready.then(() => {
      measure();
      continueRender(handle);
    });
  }, [measure, handle]);
  const size = typeof style.fontSize === "number" ? style.fontSize : 100;
  return (
    <div ref={ref} style={{ ...style, fontSize: size * k }}>
      {text.split("\n").map((line) => (
        <div key={line} style={{ display: "table", whiteSpace: "nowrap" }}>
          {line}
        </div>
      ))}
    </div>
  );
};
