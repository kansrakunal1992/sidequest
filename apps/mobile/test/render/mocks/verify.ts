// RENDER-TEST STAND-IN for src/lib/verify.ts (the real one opens the phone's browser). Records calls; answers from window.__verify*.
import { parseMyVerification } from '../../../src/core/verify-core';
const g = globalThis as any;
export const startSelfieCheck = async () => { (g.__calls ??= []).push({ kind: 'startSelfieCheck' }); return g.__verifyStartError ?? null; };
export const readMyVerification = async () => parseMyVerification(g.__myVerification ?? { verified: false, verified_at: null, latest: null });
