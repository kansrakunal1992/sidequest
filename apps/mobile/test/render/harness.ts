import { JSDOM } from 'jsdom';
import { build } from 'esbuild';

const here = new URL('./', import.meta.url).pathname;
const M = (f: string) => `${here}mocks/${f}`;
let bundle: string | null = null;
export async function getBundle(): Promise<string> {
  if (bundle) return bundle;
  const r = await build({
    entryPoints: [`${here}entry.tsx`], bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', logLevel: 'error',
    tsconfig: `${here}../../tsconfig.json`, target: 'es2020', loader: { '.ttf': 'empty', '.png': 'empty' },
    define: { 'process.env.EXPO_PUBLIC_API_URL': '"https://api.example.test"', 'process.env.NODE_ENV': '"development"', __DEV__: 'true', global: 'window' },
    alias: { 'react-native': 'react-native-web',  'expo-router': M('expo-router.tsx'), 'expo-linear-gradient': M('linear-gradient.tsx'), '@expo/vector-icons': M('icons.tsx'),
      'react-native-safe-area-context': M('safe-area.tsx'), '@/lib/supabase': M('supabase.ts'), '@/lib/session': M('session.tsx'), '@/lib/modes': M('modes.tsx'), '@/lib/api': M('api.ts'),
      '@/lib/push': M('push.ts'), '@/lib/location': M('location.ts') },
  });
  bundle = r.outputFiles[0]!.text;
  return bundle;
}

const open: any[] = [];
/** Closes every window opened by mount(), so timers inside screens (like the Game poll) cannot keep the test process alive. */
export const closeAll = () => { for (const w of open.splice(0)) { try { w.close(); } catch { /* already closed */ } } };
const plain = <T,>(v: T): T => JSON.parse(JSON.stringify(v ?? null));

export interface Page { win: any; doc: Document; calls: any[]; nav: any[]; errors: string[]; text: () => string; settle: (ms?: number) => Promise<void>; waitFor: (t: string, ms?: number) => Promise<void>; click: (text: string, nth?: number) => Promise<void>; type: (label: string, value: string) => Promise<void>; has: (t: string) => boolean; opened: () => string[]; rpcCalls: (name: string) => any[] }
export async function mount(screen: string, setup: { rpc?: Record<string, unknown>; tables?: Record<string, unknown[]>; params?: Record<string, string>; profile?: unknown; mode?: string | null; globals?: Record<string, unknown> } = {}): Promise<Page> {
  const code = await getBundle();
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://app.test/' });
  const win = dom.window as any; open.push(win);
  win.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  win.matchMedia = win.matchMedia ?? (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  win.__opened = []; win.open = (u: string) => { win.__opened.push(u); return null; };
  const errors: string[] = [];
  win.console.error = (...a: unknown[]) => { errors.push(a.map(String).join(' ').slice(0, 400)); };
  win.addEventListener('error', (e: any) => errors.push(`uncaught: ${e.message}`));
  win.__rpc = setup.rpc ?? {}; win.__tables = setup.tables ?? {}; win.__params = setup.params ?? {}; win.__calls = []; win.__nav = []; if (setup.profile) win.__profile = setup.profile; if (setup.mode !== undefined) win.__mode = setup.mode;
  for (const [k, v] of Object.entries(setup.globals ?? {})) win[k] = v;   // e.g. __pushPermission, __locResult: what the fake phone answers
  win.eval(code);
  win.__mount(screen);
  const settle = (ms = 70) => new Promise<void>((r) => setTimeout(r, ms));
  await settle(200);
  const doc = win.document as Document;
  const text = () => doc.body.textContent ?? '';
  const find = (t: string, nth = 0): HTMLElement => {
    const all = [...doc.querySelectorAll<HTMLElement>('*')].filter((e) => (e.textContent ?? '').trim() === t && ![...e.children].some((c) => (c.textContent ?? '').trim() === t));
    const el = all[nth]; if (!el) throw new Error(`no element with text "${t}". Page text: ${text().slice(0, 500)}`);
    return el;
  };
  const seen = () => win.__calls.length + win.__nav.length + win.__opened.length;
  /** Taps the closest button, then waits until the app has visibly reacted (a call, navigation or link) or a short cap passes, so slow machines do not make tests flaky. */
  const click = async (t: string, nth = 0) => {
    const before = seen(); const el = find(t, nth);
    (el.closest('[role=button],[role=tab],button') as HTMLElement | null ?? el).click();
    await settle(); const end = Date.now() + 1500; while (seen() === before && Date.now() < end) await settle(25);
  };
  const type = async (label: string, value: string) => {
    const lab = [...doc.querySelectorAll<HTMLElement>('*')].find((e) => (e.textContent ?? '').trim() === label && e.children.length === 0);
    const input = (lab?.parentElement?.querySelector('input,textarea') ?? doc.querySelector(`[aria-label="${label}"]`)) as HTMLInputElement | HTMLTextAreaElement | null;
    if (!input) throw new Error(`no input for label "${label}". Page text: ${text().slice(0, 400)}`);
    const proto = input.tagName === 'TEXTAREA' ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(input, value);
    input.dispatchEvent(new win.Event('input', { bubbles: true })); await settle();
  };
  const waitFor = async (t: string, ms = 6000) => { const end = Date.now() + ms; while (!text().includes(t)) { if (Date.now() > end) throw new Error(`timed out waiting for "${t}". Page text: ${text().slice(-500)}. Errors: ${errors.join(' | ')}`); await settle(25); } };
  return { win, doc, waitFor, get calls() { return plain(win.__calls); }, get nav() { return plain(win.__nav); }, errors, text, settle, click, type, has: (t) => text().includes(t), opened: () => [...win.__opened] as string[], rpcCalls: (n) => plain(win.__calls).filter((c: any) => c.kind === 'rpc' && c.name === n) };
}
