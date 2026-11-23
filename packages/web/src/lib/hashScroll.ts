/**
 * Bring the section a link points at (`/settings#you`, `…/settings#assistant`)
 * into view once the screen has drawn it — the browser's own jump happens
 * before a client-rendered screen has the element. Links across the app say
 * "App settings › You"; this is what makes them land there.
 */
import { useEffect } from "react";
import { useLocation } from "react-router-dom";

export function useScrollToHash(ready: boolean): void {
  const { hash } = useLocation();
  useEffect(() => {
    if (!ready || !hash) return;
    const frame = requestAnimationFrame(() => document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ block: "start" }));
    return () => cancelAnimationFrame(frame);
  }, [ready, hash]);
}
