// RENDER-TEST STAND-IN for src/lib/local-flags.ts (the real one uses the phone's secure store). Keeps flags in memory on window.__flags.
const g = globalThis as any;
export const getFlag = async (name: string) => (g.__flags ??= {})[name] ?? null;
export const setFlag = async (name: string, value: string) => { (g.__flags ??= {})[name] = value; (g.__calls ??= []).push({ kind: 'setFlag', name, value }); };
