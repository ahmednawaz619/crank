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

/**
 * Retune-style mount — injects companion `/dev-loader.js` once. Renders null.
 *
 *   import { Crank } from '@ahmednawaz/crank/react'
 *   <Crank />
 *
 * Optional: `window.__CRANK_URL__` or `VITE_CRANK_URL` for Replit public companion host.
 * Keep companion running: `npx @ahmednawaz/crank start`
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
