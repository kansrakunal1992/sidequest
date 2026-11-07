const g = globalThis as any;
export const api = { dataExportUrl: async (id: string) => { (g.__calls ??= []).push({ kind: 'api', name: 'dataExportUrl', id }); return { url: 'https://files.test/export.json', expiresInSeconds: 300 }; } };
