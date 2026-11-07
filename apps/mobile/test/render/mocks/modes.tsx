const g = globalThis as any;
export const useModes = () => ({ current: g.__mode === undefined ? 'friendship' : g.__mode, active: [{ modeId: 'friendship', paused: false, availability: '' }, { modeId: 'serious_dating', paused: false, availability: '' }], togglePause: async () => {}, addMode: async () => {} });
