import { useEffect, useState } from 'react';

/** Screens narrower than this (smaller than an iPad) get the reduced phone experience. */
export const PHONE_MAX = 768;
/** From this width the insight panel sits beside the list. */
export const SIDE_PANEL_MIN = 1024;

/** True when the window is at least `px` wide. Without matchMedia (tests, old browsers) it assumes a wide screen. */
export function useMinWidth(px: number): boolean {
  const query = `(min-width: ${px}px)`;
  const read = () => (typeof window === 'undefined' || !window.matchMedia ? true : window.matchMedia(query).matches);
  const [matches, setMatches] = useState(read);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(query);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener?.('change', update);
    return () => mq.removeEventListener?.('change', update);
  }, [query]);
  return matches;
}

/** True on phones: the reduced experience. */
export const usePhone = () => !useMinWidth(PHONE_MAX);
