import type { ReactElement } from 'react';

export interface CrankProps {
  /** Full loader script URL (overrides companionUrl). */
  src?: string;
  /** Companion base URL, e.g. https://3344-….replit.dev */
  companionUrl?: string;
  /** Alias for companionUrl. */
  url?: string;
}

export declare function resolveCrankCompanionUrl(props?: CrankProps): string;
export declare function resolveCrankLoaderSrc(props?: CrankProps): string;
/** Infer https://3344-… from the current Replit preview hostname. */
export declare function detectReplitCompanionUrl(): string | null;

/**
 * Mount — injects companion loader once. Renders null.
 *
 * Prefers same-origin `/@crank/dev-loader.js` (Vite proxy) so the panel works
 * inside Replit iframe previews; falls back to public companion / localhost.
 *
 *   import { Crank } from '@ahmednawaz/crank/react'
 *   <Crank />
 *
 * Optional: `window.__CRANK_URL__` or `VITE_CRANK_URL`. Keep companion up:
 * `npx @ahmednawaz/crank start`
 */
export declare function Crank(props?: CrankProps): ReactElement | null;
export declare const CrankLoader: typeof Crank;
export default Crank;

declare global {
  interface Window {
    __CRANK_URL__?: string;
    __CRANK_LOADER__?: boolean;
  }
}

export {};
