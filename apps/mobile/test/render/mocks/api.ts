const g = globalThis as any;
const rec = (c: unknown) => { (g.__calls ??= []).push(c); };
export const api = {
  dataExportUrl: async (id: string) => { rec({ kind: 'api', name: 'dataExportUrl', id }); return { url: 'https://files.test/export.json', expiresInSeconds: 300 }; },
  config: async () => ({ calls: false, photos: true, chatImages: true, exports: true, push: g.__pushConfigured ?? true, verification: g.__verification ?? true }),
  createInvite: async (b: unknown) => { rec({ kind: 'api', name: 'createInvite', body: b }); return { id: 'inv1', ...(b as object) }; },
  pushTest: async () => { rec({ kind: 'api', name: 'pushTest' }); return g.__pushTest ?? { tokens: 1, sent: 1, error: null }; },
};
