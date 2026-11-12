const g = globalThis as any;
const rec = (c: unknown) => { (g.__calls ??= []).push(c); };
export const api = {
  dataExportUrl: async (id: string) => { rec({ kind: 'api', name: 'dataExportUrl', id }); return { url: 'https://files.test/export.json', expiresInSeconds: 300 }; },
  config: async () => ({ calls: false, photos: true, chatImages: true, exports: true, push: g.__pushConfigured ?? true, verification: g.__verification ?? true }),
  createInvite: async (b: unknown) => { rec({ kind: 'api', name: 'createInvite', body: b }); return { id: 'inv1', ...(b as object) }; },
  getInvite: async (id: string) => { rec({ kind: 'api', name: 'getInvite', id }); return g.__invite ?? { id, senderId: 'other-1', recipientId: g.__me ?? 'me-1', format: 'video', state: 'accepted', startsAt: new Date(Date.now() + 120_000).toISOString(), durationMinutes: 20 }; },
  callToken: async (id: string) => { rec({ kind: 'api', name: 'callToken', id }); if (g.__tokenError) throw new Error(g.__tokenError); return { url: 'https://wp.daily.co/invite-1', token: 'tok-1', room: 'invite-1', audioOnly: false, notAfter: g.__notAfter ?? new Date(Date.now() + 3_600_000).toISOString() }; },
  pushTest: async () => { rec({ kind: 'api', name: 'pushTest' }); return g.__pushTest ?? { tokens: 1, sent: 1, error: null }; },
};
