/**
 * The app's address, for the demo's layer: the app runs in a hash router,
 * whose moves (history.pushState) fire no event the layer can hear, so the
 * hash is also read a few times a second.
 */
import { useEffect, useState } from "react";

export function useHash(): string {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const read = () => setHash(window.location.hash);
    window.addEventListener("hashchange", read);
    const timer = setInterval(read, 300);
    return () => {
      window.removeEventListener("hashchange", read);
      clearInterval(timer);
    };
  }, []);
  return hash;
}
