/**
 * Next.js entry — same Retune-style `<Crank />` (client component).
 *
 *   import { Crank } from '@ahmednawaz/crank/next'
 *   <Crank />
 */

'use client';

export {
  Crank,
  CrankLoader,
  resolveCrankCompanionUrl,
  resolveCrankLoaderSrc
} from './react.mjs';

export { Crank as CrankScript, Crank as default } from './react.mjs';
