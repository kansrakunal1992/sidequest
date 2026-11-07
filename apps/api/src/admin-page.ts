import { randomBytes } from 'node:crypto';
import { ADMIN_SCRIPT } from './admin-script.ts';

export const newNonce = (): string => randomBytes(16).toString('base64url');

/** Data for the page script, safe to put inside a <script> element: no character that could end it or start a comment. */
export const safeJson = (v: unknown): string =>
  JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

/** Only this page's own nonce may run script or style; the page may talk only to this server and to Supabase; nothing can frame it. */
export function adminHeaders(nonce: string, supabaseUrl: string): Record<string, string> {
  return {
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src ${supabaseUrl} data:; connect-src 'self' ${supabaseUrl}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer', 'cross-origin-opener-policy': 'same-origin',
  };
}

const CSS = `
:root{color-scheme:light dark;--bg:#fff;--fg:#1b1b1f;--muted:#666;--line:#d8d8de;--accent:#4a3fd0;--bad:#b3261e;--ok:#1b6e3a}
@media (prefers-color-scheme:dark){:root{--bg:#16161a;--fg:#ececf1;--muted:#9a9aa6;--line:#34343c;--accent:#9d93ff;--bad:#ff8a80;--ok:#7ddb9b}}
body{margin:0;font:15px/1.45 system-ui,sans-serif;background:var(--bg);color:var(--fg)}
header{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid var(--line)}
main{max-width:1000px;margin:0 auto;padding:16px}
button,input,select,textarea{font:inherit;color:inherit;background:transparent;border:1px solid var(--line);border-radius:8px;padding:8px 10px;margin:4px 4px 4px 0}
button{cursor:pointer}button[aria-pressed=true]{border-color:var(--accent);color:var(--accent)}button.primary{background:var(--accent);color:#fff;border-color:var(--accent)}
.item{display:block;width:100%;text-align:left;border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin:8px 0}.item small{display:block;color:var(--muted)}
.muted{color:var(--muted)}.bad{color:var(--bad)}.ok{color:var(--ok)}.msg.reported{background:rgba(179,38,30,.12);padding:4px 8px;border-radius:6px}
.cols{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.3fr);gap:16px}@media (max-width:720px){.cols{grid-template-columns:1fr}}
img{max-width:100%;max-height:420px;border-radius:8px}h3{margin:16px 0 4px;font-size:15px}textarea{width:100%;box-sizing:border-box}
`;

export function adminPageHtml(o: { nonce: string; supabaseUrl: string; anonKey: string }): string {
  const n = o.nonce;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>SideQuest moderation</title><style nonce="${n}">${CSS}</style></head>
<body>
<header><strong>SideQuest moderation</strong><button id="signout" type="button">Sign out</button></header>
<main>
<p id="msg" class="ok" role="status"></p>
<section id="login"><h2>Sign in</h2><p class="muted">Moderators only. Use the email address on your moderator account; you will get a one-time code.</p>
<input id="email" type="email" autocomplete="username" placeholder="Email"><button id="send" type="button">Send code</button>
<div id="step2" hidden><input id="code" inputmode="numeric" autocomplete="one-time-code" placeholder="Code"><button id="verify" type="button" class="primary">Sign in</button></div></section>
<section id="app" hidden><nav><button type="button" data-tab="reports" aria-pressed="true">Reports</button><button type="button" data-tab="appeals" aria-pressed="false">Appeals</button><button type="button" data-tab="photos" aria-pressed="false">Photos</button></nav>
<div class="cols"><div id="list"></div><div id="detail"></div></div></section>
</main>
<script type="application/json" id="cfg">${safeJson({ supabaseUrl: o.supabaseUrl, anonKey: o.anonKey })}</script>
<script nonce="${n}">${ADMIN_SCRIPT}</script>
</body></html>`;
}
