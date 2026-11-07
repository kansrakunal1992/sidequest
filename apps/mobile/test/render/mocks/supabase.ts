// RENDER-TEST STAND-IN for the Supabase client. Records every call and answers from tables/handlers the test installs on window.
const g = globalThis as any;
const rec = (c: unknown) => { (g.__calls ??= []).push(c); };
function builder(table: string) {
  const ops: unknown[] = [];
  const b: any = new Proxy({}, {
    get(_t, prop: string) {
      if (prop === 'then') return (res: (v: unknown) => void) => { rec({ kind: 'from', table, ops }); const rows = g.__tables?.[table] ?? []; res({ data: rows, error: null }); };
      if (prop === 'maybeSingle' || prop === 'single') return async () => { rec({ kind: 'from', table, ops }); return { data: (g.__tables?.[table] ?? [])[0] ?? null, error: null }; };
      return (...args: unknown[]) => { ops.push([prop, ...args]); return b; };
    },
  });
  return b;
}
export const supabase = {
  rpc: async (name: string, args?: unknown) => {
    rec({ kind: 'rpc', name, args });
    const h = g.__rpc?.[name];
    if (h === undefined) return { data: null, error: { code: 'MOCK', message: `no mock for ${name}` } };
    try { return { data: typeof h === 'function' ? h(args) : h, error: null }; } catch (e) { return { data: null, error: { code: (e as any).code ?? '', message: (e as Error).message } }; }
  },
  from: builder,
  auth: { getSession: async () => ({ data: { session: null } }) },
  storage: { from: () => ({ createSignedUrls: async () => ({ data: [] }) }) },
};
