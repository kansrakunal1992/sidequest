// RENDER-TEST STAND-IN for src/lib/location.ts (the real one needs the native location module). Records calls; answers from window.__loc*.
const g = globalThis as any;
const rec = (c: unknown) => { (g.__calls ??= []).push(c); };
export const readLocationStatus = async () => g.__locStatus ?? { permission: 'granted', servicesOn: true };
export const getApproxLocation = async (o: { ask: boolean }) => { rec({ kind: 'getApproxLocation', ask: o.ask }); return g.__locResult ?? { reason: 'granted', lat: 28.46, lng: 77.03, city: 'Gurugram' }; };
export const locateTypedCity = async (city: string) => { rec({ kind: 'locateTypedCity', city }); return g.__cityResult ?? { reason: 'granted', lat: 22.57, lng: 88.36, city }; };
