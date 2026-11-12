// RENDER-TEST STAND-IN for src/lib/call-permissions.ts. window.__perm overrides the answer.
const g = globalThis as any;
export const ensureCallPermissions = async (audioOnly: boolean) => { (g.__calls ??= []).push({ kind: 'permissions', audioOnly }); return g.__perm ?? { ok: true, cameraDenied: false, message: null }; };
