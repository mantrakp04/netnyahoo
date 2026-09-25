import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { continueRender, delayRender } from "remotion";

// One or more lines (split on \n), the whole block scaled down so the widest line fits `width`.
// Measured from the DOM after the fonts are in, so it follows the real font; the frame is held
// until the measured size has been applied.
export const Fit: React.FC<{ text: string; width: number; style: React.CSSProperties }> = ({ text, width, style }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [fontsReady, setFontsReady] = useState(false);
  const [k, setK] = useState<number | null>(null);
  const [handle] = useState(() => delayRender("Fitting a headline"));
  useEffect(() => {
    // Load this exact face first: fonts.ready alone can resolve before the face has started loading.
    const family = String(style.fontFamily ?? "sans-serif");
    document.fonts
      .load(`${style.fontWeight ?? 400} 100px "${family}"`)
      .then(() => document.fonts.ready)
      .then(() => setFontsReady(true));
  }, [style.fontFamily, style.fontWeight]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !fontsReady) return;
    const natural = Math.max(...Array.from(el.children).map((c) => (c as HTMLElement).scrollWidth)) / (k ?? 1);
    const next = Math.min(1, width / natural);
    if (k === null || Math.abs(next - k) > 0.001) setK(next);
  }, [fontsReady, text, width, style.fontSize, k]);
  useEffect(() => {
    if (k !== null) continueRender(handle);
  }, [k, handle]);
  const size = typeof style.fontSize === "number" ? style.fontSize : 100;
  return (
    <div ref={ref} style={{ ...style, fontSize: size * (k ?? 1), visibility: k === null ? "hidden" : "visible" }}>
      {text.split("\n").map((line) => (
        <div key={line} style={{ display: "table", whiteSpace: "nowrap" }}>
          {line}
        </div>
      ))}
    </div>
  );
};
