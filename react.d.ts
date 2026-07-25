import type { ReactElement } from 'react';

export interface CrankProps {
  /** @deprecated Panel is bundled; only use for legacy companion-hosted loaders. */
  src?: string;
  /** Companion API base URL, e.g. https://3344-….replit.dev */
  companionUrl?: string;
  /** Alias for companionUrl. */
  url?: string;
  /** Show even when NODE_ENV is production (Retune-style). */
  force?: boolean;
}

export declare function resolveCrankCompanionUrl(props?: CrankProps): string;
export declare function resolveCrankLoaderSrc(props?: CrankProps): string;
/** Infer https://3344-… from the current Replit preview hostname. */
export declare function detectReplitCompanionUrl(): string | null;

/**
 * Mount near app root. Boots the **bundled** panel (same-origin) — Retune pattern.
 *
 *   import { Crank } from '@ahmednawaz/crank/react'
 *   <Crank />
 *
 * Keep companion running for Glean/MCP: `npx @ahmednawaz/crank start`
 */
export declare function Crank(props?: CrankProps): ReactElement | null;
export declare const CrankLoader: typeof Crank;
export default Crank;

declare global {
  interface Window {
    __CRANK_URL__?: string;
    __CRANK_LOADER__?: boolean;
    __CRANK_COMPANION__?: string;
    __CRANK_ASSET_BASE__?: string;
  }
}

export {};
