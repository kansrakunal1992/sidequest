import { safeJson } from './admin-page.ts';

/** Public pages Google Play requires for a social/dating app: privacy policy, terms with community guidelines (including the child-safety rule), and a web way to delete an account. */
export interface LegalConfig { legalName: string; contactEmail: string; childSafetyEmail: string; supabaseUrl: string; anonKey: string | null; appName: string; /** Name of the selfie-verification provider when that feature is switched on. */ verificationProvider?: string | null }
export const POLICY_DATE = '7 November 2026';

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const CSS = `:root{color-scheme:light dark;--bg:#fff;--fg:#1b1b1f;--muted:#5b5b66;--line:#d8d8de;--accent:#4a3fd0;--bad:#b3261e;--ok:#1b6e3a}
@media (prefers-color-scheme:dark){:root{--bg:#16161a;--fg:#ececf1;--muted:#a3a3b0;--line:#34343c;--accent:#9d93ff;--bad:#ff8a80;--ok:#7ddb9b}}
body{margin:0;font:16px/1.6 system-ui,sans-serif;background:var(--bg);color:var(--fg)}main{max-width:760px;margin:0 auto;padding:20px 16px 60px}
h1{font-size:26px;margin:.4em 0}h2{font-size:19px;margin:1.6em 0 .3em}nav a{margin-right:14px;color:var(--accent)}a{color:var(--accent)}.muted{color:var(--muted)}
.note{border:1px solid var(--line);border-radius:10px;padding:10px 14px;margin:14px 0}button,input{font:inherit;color:inherit;background:transparent;border:1px solid var(--line);border-radius:8px;padding:9px 12px;margin:4px 6px 4px 0}
button{cursor:pointer}button.primary{background:var(--accent);color:#fff;border-color:var(--accent)}.bad{color:var(--bad)}.ok{color:var(--ok)}`;

export function pageHeaders(nonce: string | null, supabaseUrl: string | null): Record<string, string> {
  const script = nonce && supabaseUrl ? `script-src 'nonce-${nonce}'; connect-src ${supabaseUrl};` : '';   // only the deletion page runs script
  return { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': `default-src 'none'; style-src 'nonce-${nonce ?? 'none'}'; ${script} base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    'cache-control': 'public, max-age=300', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };
}

function shell(c: LegalConfig, nonce: string, title: string, body: string, extra = ''): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} - ${esc(c.appName)}</title><style nonce="${nonce}">${CSS}</style></head>
<body><main><nav><a href="/privacy">Privacy Policy</a><a href="/terms">Terms and Community Guidelines</a><a href="/delete-account">Delete your account</a></nav>${body}${extra}</main></body></html>`;
}

export function privacyHtml(c: LegalConfig, nonce: string): string {
  const A = esc(c.appName), L = esc(c.legalName), E = esc(c.contactEmail);
  return shell(c, nonce, 'Privacy Policy', `
<h1>${A} Privacy Policy</h1><p class="muted">Last updated ${POLICY_DATE}. ${A} is run by ${L} ("we", "us"). You can reach us at <a href="mailto:${E}">${E}</a> about anything here.</p>
<div class="note">${A} is for adults only (18+). We do not knowingly collect information from anyone under 18, and we remove accounts we find belong to someone under 18.</div>
<h2>What we collect</h2>
<p><strong>Information you give us:</strong> your email address (to sign you in with a one-time code); your name or nickname, date of birth (to check you are 18+ and show your age), gender, city and the area you choose; photos you upload; the words on your profile, your interests, and your preferences for each vibe; messages and photos you send in chats; plans, invitations, calendar entries and check-ins you create; your answers in short games; reports, blocks and appeals you make; and, if you choose to use them, your friend code, wingperson, trusted-contact and partner-link settings.</p>
<p><strong>Information from your phone, only with your permission:</strong> your approximate location (we use it to find people and plans near you and do not store your exact position); the photos you pick for your profile or chats (we use the Android photo picker, so we only receive the photos you choose); and permission to send you notifications.</p>
<p><strong>Information created by using the app:</strong> who you liked, passed, saved or visited (unless you browse incognito), your sign-in and security records, a notification token for your phone, and records of reports and moderation decisions.</p>
<h2>How we use it</h2>
<p>To run ${A}: sign you in, show your profile to people in the vibes you choose, suggest people and plans, deliver messages and notifications, keep the community safe (review reports, block people who break the rules, stop people who were removed from coming back), and respond to your requests. We do not sell your personal information. We do not show advertising and we do not use your information to target ads.</p>
<p>${A} is free. Likes, visitors and messages are never hidden behind payment.</p>
<h2>Who sees your information</h2>
<p>Other members see only what you choose to show on your profile for the vibe they are looking at. Your exact birthday, email and exact location are never shown. Photos you add to chats stay hidden until the other person chooses to open them. People you block cannot see you.</p>
<p>A wingperson, trusted contact or partner you invite sees only the limited things you allow in the app (for example, a wingperson can see your profile wording but never your chats). A trusted contact is told, without your location, if you ask for help or do not answer a safety check-in.</p>
<p>Our moderators can see the specific content that was reported (for example a reported message and a few messages around it) and the account history needed to decide. Their access is logged.</p>
${c.verificationProvider ? `<h2>Photo verification (optional)</h2>
<p>If you choose to verify your photos, you take a live selfie on a page run by <strong>${esc(c.verificationProvider)}</strong>. They check that a real person is present and compare your face with one of your approved profile photos, and tell us only whether it matched. This uses face data, which is sensitive, so we only do it after you agree on the verification screen, and you can say no and keep using ${A}. We do not receive or keep your selfie. We ask ${esc(c.verificationProvider)} to delete the session and the selfie as soon as we have the result. If it matches, your profile shows a \"photo verified\" badge. If it does not, nothing happens to your account.</p>` : ''}
<h2>Voice and video calls (optional)</h2>
<p>If calls are switched on, you can join a voice or video call for a plan that you and the other person have confirmed. Your phone asks for microphone and camera access only when you tap Join. Sound and video travel through our call provider, <strong>Daily</strong>, and are shared only with the other person on that plan. ${A} does not record calls. The provider may keep technical connection logs, such as when a call started and ended.</p>
<h2>Services that help us run ${A}</h2>
<p>We use these providers to host and deliver the service. They process data for us and may not use it for their own purposes: <strong>Supabase</strong> (database, sign-in and file storage), <strong>Railway</strong> (the servers that run our application), <strong>Google Firebase Cloud Messaging</strong> (to deliver push notifications; messages contain no names or message text), and, only if we switch these features on, a video-call provider (Daily) and an image-safety checking provider for photos. We may also disclose information if the law requires it, to protect someone's safety, or to report suspected child sexual abuse material to the National Center for Missing &amp; Exploited Children or the relevant authority.</p>
<h2>How long we keep it</h2>
<p>While your account is open we keep your information so the app works. Messages you send are kept until you or the other person deletes the conversation or either account is deleted. If you delete your account (in the app under Safety and privacy &gt; Your data, or on our <a href="/delete-account">web page</a>), your profile is hidden immediately and after 7 days we permanently delete your account, photos, messages and the rest of your content, and files in storage. You can cancel during those 7 days. Data exports we create for you are removed after 7 days. Backups made by our hosting providers are overwritten on their normal schedule.</p>
<p><strong>What we may keep after deletion:</strong> a record that a deletion was requested (without your content), and, if your account was removed for serious rule-breaking, a one-way fingerprint of your email address so the same person cannot immediately return, together with limited records of reports and decisions needed to keep other people safe or to meet legal duties. We keep these only as long as needed for those purposes.</p>
<h2>Security</h2>
<p>Information is sent over encrypted connections. Access to the database is restricted by rules that let each person reach only their own data and what others have chosen to share. No system is perfectly secure; tell us at once if you think your account was accessed by someone else.</p>
<h2>Your choices and rights</h2>
<p>You can edit your profile, pause your account, browse incognito, turn off read receipts, block and report people, download a copy of your data, and delete your account, all in the app. Depending on where you live (for example in the EU, UK or California) you may also have rights to access, correct, delete, restrict or object to our use of your information, and to complain to your data protection authority. Email <a href="mailto:${E}">${E}</a> and we will respond within a reasonable time, normally within 30 days.</p>
<h2>International transfers</h2><p>Our providers may process data in countries other than yours. Where required, we rely on appropriate safeguards for those transfers.</p>
<h2>Changes</h2><p>If we change this policy in a way that matters we will tell you in the app before it takes effect. The date at the top shows the latest version.</p>
<h2>Contact</h2><p>${L}, <a href="mailto:${E}">${E}</a>. Child safety concerns: <a href="mailto:${esc(c.childSafetyEmail)}">${esc(c.childSafetyEmail)}</a>.</p>`);
}

export function termsHtml(c: LegalConfig, nonce: string): string {
  const A = esc(c.appName), E = esc(c.contactEmail), CS = esc(c.childSafetyEmail);
  return shell(c, nonce, 'Terms and Community Guidelines', `
<h1>${A} Terms of Use and Community Guidelines</h1><p class="muted">Last updated ${POLICY_DATE}. By creating an account or using ${A} you agree to these terms and to our <a href="/privacy">Privacy Policy</a>.</p>
<h2>Who can use ${A}</h2><p>You must be at least 18. You must give accurate information about your age and yourself, use your own account only, and not use ${A} if you have been removed from it.</p>
<h2>Community guidelines</h2>
<p>${A} is for meeting people and doing things together in real life. Be kind, be honest and respect each other's boundaries and choices of vibe. These are never allowed:</p>
<ul>
<li><strong>Anything that sexually exploits or endangers children.</strong> We prohibit child sexual abuse and exploitation (CSAE) in every form: sexual content involving anyone under 18, grooming, sexualising minors, sextortion, trafficking, and sharing or asking for such material. Anyone under 18 is not allowed on ${A}. We remove such content and accounts and report confirmed child sexual abuse material to the National Center for Missing &amp; Exploited Children or the relevant authority.</li>
<li>Harassment, threats, bullying, stalking, hate speech, or pressure after someone says no.</li>
<li>Sexually explicit images or messages sent to people who have not asked for them, intimate images shared without consent, or anything that exploits someone sexually.</li>
<li>Asking for or offering sex, companionship or dating in exchange for money, gifts or financial support, escort services, and "sugar dating".</li>
<li>Scams, asking for money, impersonation, fake profiles, spam or advertising, and selling anything.</li>
<li>Violence, self-harm promotion, illegal drugs and weapons, or anything illegal.</li>
<li>Photos that are not of you in profile photos, or photos that break these rules. Photos are checked before others see them.</li>
<li>Trying to get around blocks, suspensions or bans, or to collect other people's information.</li>
</ul>
<h2>Reporting, blocking and enforcement</h2>
<p>You can report any profile, message, photo or plan, and block anyone, from inside the app. People you block cannot see or contact you. Reports are reviewed by people. We may remove content, warn, suspend or permanently remove accounts, and we may do so without notice when someone's safety is at risk. If you think we got it wrong you can appeal inside the app and a person will read it. To report a child-safety concern outside the app, email <a href="mailto:${CS}">${CS}</a>.</p>
<h2>Meeting people safely</h2>
<p>Meet in a public place the first time, tell a friend where you are going, arrange your own transport, and trust your instincts. ${A} offers trusted contacts and check-ins to help. We cannot verify everyone and are not responsible for what members say or do, online or in person.</p>
<h2>Your content</h2><p>You keep ownership of what you post. You give us permission to store it and show it to other members as you choose, so the service can work. You are responsible for what you post and must have the right to share it.</p>
<h2>Free service, no guarantees</h2><p>${A} is free to use and we may change or stop features. We provide it "as is". To the extent the law allows, we are not liable for indirect or consequential losses, and our total liability to you is limited to the amount the law requires us not to exclude. Nothing here limits rights you have by law that cannot be limited.</p>
<h2>Ending your account</h2><p>You can delete your account at any time in the app or at <a href="/delete-account">our web page</a>. We may suspend or remove accounts that break these terms.</p>
<h2>Contact</h2><p>${esc(c.legalName)}, <a href="mailto:${E}">${E}</a>.</p>`);
}

export const DELETE_SCRIPT = String.raw`
(function () {
  'use strict';
  var cfg = JSON.parse(document.getElementById('cfg').textContent);
  var token = null, email = '';
  function $(id) { return document.getElementById(id); }
  function msg(t, bad) { var m = $('msg'); m.textContent = t || ''; m.className = bad ? 'bad' : 'ok'; }
  async function post(url, body) {
    var h = { apikey: cfg.anonKey, 'content-type': 'application/json' }; if (token) h.authorization = 'Bearer ' + token;
    var res = await fetch(url, { method: 'POST', headers: h, body: JSON.stringify(body || {}) });
    var data = null; try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) { var err = new Error('request_failed'); err.status = res.status; throw err; }
    return data;
  }
  function rpc(name) { return post(cfg.supabaseUrl + '/rest/v1/rpc/' + name, {}); }
  function when(t) { try { return new Date(t).toLocaleString(); } catch (e) { return String(t); } }
  async function refresh() {
    var rows = await rpc('my_data_requests');
    var pending = null;
    rows.forEach(function (r) { if (r.kind === 'deletion' && r.status === 'queued' && (!pending || r.requested_at > pending.requested_at)) pending = r; });
    $('state').textContent = pending ? 'Deletion requested on ' + when(pending.requested_at) + '. Your account is hidden now and everything is permanently deleted 7 days after that date. You can cancel until then.' : 'No deletion is pending for this account.';
    $('del').hidden = !!pending; $('cancel').hidden = !pending;
  }
  $('send').addEventListener('click', async function () {
    email = $('email').value.trim(); if (!email) return;
    try { await post(cfg.supabaseUrl + '/auth/v1/otp', { email: email, create_user: false }); $('step2').hidden = false; msg('If that email has a Waypoint account, a code is on its way.', false); } catch (e) { msg('Something went wrong. Please try again, or email us.', true); }
  });
  $('verify').addEventListener('click', async function () {
    try {
      var d = await post(cfg.supabaseUrl + '/auth/v1/verify', { type: 'email', email: email, token: $('code').value.trim() });
      token = d && d.access_token ? d.access_token : null;
      if (!token) { msg('That code did not work.', true); return; }
      $('code').value = ''; $('login').hidden = true; $('account').hidden = false; msg('', false); await refresh();
    } catch (e) { msg('That code did not work. Check it and try again.', true); }
  });
  $('del').addEventListener('click', async function () {
    if (!window.confirm('Delete your account? It is hidden now and permanently deleted in 7 days. You can cancel before then.')) return;
    try { await rpc('request_deletion'); msg('Done. Your account is now hidden and will be deleted in 7 days.', false); await refresh(); } catch (e) { msg('Could not request deletion. If you have a suspended account, email us instead.', true); }
  });
  $('cancel').addEventListener('click', async function () {
    try { await rpc('cancel_deletion'); msg('Deletion cancelled. Your account is back.', false); await refresh(); } catch (e) { msg('Could not cancel. Please email us.', true); }
  });
})();
`;

export function deleteAccountHtml(c: LegalConfig, nonce: string): string {
  const A = esc(c.appName), E = esc(c.contactEmail);
  return shell(c, nonce, 'Delete your account', `
<h1>Delete your ${A} account</h1>
<p>You can ask us to delete your ${A} account and all the data linked to it without installing the app. Sign in below with the email address of your account.</p>
<h2>What happens</h2>
<ul><li>Your profile is hidden straight away.</li><li>After <strong>7 days</strong> your account, photos, messages, matches, plans and everything else linked to you are permanently deleted, and files are removed from storage. You can cancel at any time during those 7 days (here or in the app).</li>
<li>We may keep: a record that you asked for deletion (no content), and, if an account was removed for serious rule-breaking, a one-way fingerprint of its email address and limited safety records, so the person cannot simply return and others stay safe. See our <a href="/privacy">Privacy Policy</a>.</li></ul>
<p id="msg" role="status" class="ok"></p>
<section id="login"><input id="email" type="email" autocomplete="username" placeholder="Your account email"><button id="send" type="button">Send me a code</button>
<div id="step2" hidden><input id="code" inputmode="numeric" autocomplete="one-time-code" placeholder="Code from the email"><button id="verify" type="button" class="primary">Continue</button></div></section>
<section id="account" hidden><p id="state"></p><button id="del" type="button" class="primary">Delete my account</button><button id="cancel" type="button" hidden>Cancel the deletion</button></section>
<p class="muted">Cannot sign in? Email <a href="mailto:${E}">${E}</a> from the address on your account and we will help.</p>
<script type="application/json" id="cfg">${safeJson({ supabaseUrl: c.supabaseUrl, anonKey: c.anonKey })}</script><script nonce="${nonce}">${DELETE_SCRIPT}</script>`);
}
