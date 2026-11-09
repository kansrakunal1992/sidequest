// RENDER-TEST STAND-IN for src/lib/push.ts (the real one needs the native notifications module). Records calls; answers from window.__push*.
const g = globalThis as any;
const rec = (c: unknown) => { (g.__calls ??= []).push(c); };
export const readPushPermission = async () => g.__pushPermission ?? 'granted';
export const enablePush = async (_userId: string, ask: boolean) => { rec({ kind: 'enablePush', ask }); return g.__pushResult ?? 'ok'; };
export const openAppSettings = () => { rec({ kind: 'openSettings' }); };
export const setupPush = async () => {};
export const useNotificationRouting = () => {};
