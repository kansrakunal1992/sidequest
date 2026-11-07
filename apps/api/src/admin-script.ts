/**
 * The moderation page's browser script. Rules it follows (a test enforces them):
 *  - Everything that came from the server is shown with textContent / setAttribute of a validated URL. Never innerHTML, document.write or eval.
 *  - No inline event handlers; listeners are added with addEventListener.
 *  - The moderator's own sign-in token lives in a JS variable only (not storage, not a cookie) and is used for every call,
 *    so the database's role checks (has_role) decide what this person may do; this page grants nothing.
 * Written as a String.raw block: it must not contain a backtick or a dollar-brace sequence.
 */
export const ADMIN_SCRIPT = String.raw`
(function () {
  'use strict';
  var cfg = JSON.parse(document.getElementById('cfg').textContent);
  var token = null, email = '';
  function $(id) { return document.getElementById(id); }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function el(tag, opts, kids) {
    var e = document.createElement(tag);
    if (opts) Object.keys(opts).forEach(function (k) {
      if (k === 'text') e.textContent = String(opts[k]);
      else if (k === 'class') e.className = opts[k];
      else if (k.slice(0, 2) === 'on' && typeof opts[k] === 'function') e.addEventListener(k.slice(2), opts[k]);
      else if (typeof opts[k] !== 'function') e.setAttribute(k, String(opts[k]));
    });
    (kids || []).forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }
  function msg(text, bad) { var m = $('msg'); m.textContent = text || ''; m.className = bad ? 'bad' : 'ok'; }
  function fail(e) {
    if (e && (e.status === 401 || e.status === 403 || e.code === '42501')) msg('Not allowed: this account is not a moderator, or the session has expired. Sign in again.', true);
    else msg('Something went wrong' + (e && e.status ? ' (' + e.status + ')' : '') + '. Nothing was changed unless a confirmation says so.', true);
    if (e && e.status === 401) signOut();
  }
  function headers() { var h = { apikey: cfg.anonKey, 'content-type': 'application/json' }; if (token) h.authorization = 'Bearer ' + token; return h; }
  async function http(url, body) {
    var res = await fetch(url, { method: 'POST', headers: headers(), body: JSON.stringify(body || {}) });
    var data = null; try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) { var err = new Error('request_failed'); err.status = res.status; err.code = data && data.code ? String(data.code) : ''; throw err; }
    return data;
  }
  function rpc(name, args) { return http(cfg.supabaseUrl + '/rest/v1/rpc/' + name, args); }
  function when(t) { try { return new Date(t).toLocaleString(); } catch (e) { return String(t); } }

  function signOut() { token = null; $('app').hidden = true; $('login').hidden = false; $('step2').hidden = true; clear($('list')); clear($('detail')); }
  function showApp() { $('login').hidden = true; $('app').hidden = false; show('reports'); }

  $('send').addEventListener('click', async function () {
    email = $('email').value.trim(); if (!email) return;
    try { await http(cfg.supabaseUrl + '/auth/v1/otp', { email: email, create_user: false }); $('step2').hidden = false; msg('If that address belongs to a moderator, a code is on its way.', false); } catch (e) { fail(e); }
  });
  $('verify').addEventListener('click', async function () {
    try {
      var d = await http(cfg.supabaseUrl + '/auth/v1/verify', { type: 'email', email: email, token: $('code').value.trim() });
      token = d && d.access_token ? d.access_token : null;
      if (!token) { msg('That code did not work.', true); return; }
      $('code').value = ''; msg('', false); showApp();
    } catch (e) { fail(e); }
  });
  $('signout').addEventListener('click', signOut);
  Array.prototype.forEach.call(document.querySelectorAll('[data-tab]'), function (b) { b.addEventListener('click', function () { show(b.getAttribute('data-tab')); }); });

  function show(tab) {
    clear($('list')); clear($('detail')); msg('', false);
    Array.prototype.forEach.call(document.querySelectorAll('[data-tab]'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-tab') === tab)); });
    if (tab === 'reports') loadReports(); else if (tab === 'appeals') loadAppeals(); else loadPhotos();
  }
  function empty(text) { $('list').appendChild(el('p', { class: 'muted', text: text })); }

  async function loadReports() {
    try {
      var rows = await rpc('mod_queue', { p_status: 'open', p_limit: 50 });
      if (!rows.length) return empty('No open reports.');
      rows.forEach(function (r) {
        $('list').appendChild(el('button', { class: 'item', onclick: function () { openReport(r); } }, [
          el('strong', { text: r.reason }),
          el('span', { text: ' ' + r.content_type + ' about ' + (r.reported_name || '(deleted account)') }),
          el('small', { text: r.reporters_7d + ' reporter(s) this week, ' + r.total_reports + ' report(s) ever, ' + r.prior_actions + ' past action(s), ' + when(r.created_at) })
        ]));
      });
    } catch (e) { fail(e); }
  }
  function section(title, kids) { return el('section', null, [el('h3', { text: title })].concat(kids)); }
  function kv(k, v) { return el('p', null, [el('span', { class: 'muted', text: k + ': ' }), el('span', { text: v === null || v === undefined ? '-' : String(v) })]); }

  async function openReport(row) {
    var d = $('detail'); clear(d); msg('', false);
    try {
      var ctx = await rpc('mod_report_context', { p_report: row.report_id });
      var rep = ctx.report, who = ctx.reported || {}, c = ctx.content || {};
      d.appendChild(section('Report', [kv('Reason', rep.reason), kv('Details', rep.details), kv('About', rep.content_type), kv('Received', when(rep.created_at))]));
      d.appendChild(section('Reported person', [kv('Name', who.name), kv('Account', who.state), kv('Age', who.age), kv('Joined', who.joined ? when(who.joined) : '-')]));
      if (c.messages) {
        d.appendChild(section('Conversation around the reported message', c.messages.map(function (m) {
          return el('p', { class: m.is_reported ? 'msg reported' : 'msg' }, [el('strong', { text: m.who + ': ' }), el('span', { text: (m.text || '') + (m.media ? ' [' + m.media + ']' : '') }), el('small', { text: ' ' + when(m.at) })]);
        })));
      } else if (c.title || c.photo_id) {
        d.appendChild(section('Reported content', [kv('Title', c.title), kv('Description', c.description), kv('Status', c.status || c.photo_status)]));
      }
      d.appendChild(section('Past actions', ctx.history.length ? ctx.history.map(function (h) { return el('p', { text: h.action + ' - ' + (h.notes || '') + ' (' + when(h.at) + ')' }); }) : [el('p', { class: 'muted', text: 'None' })]));
      d.appendChild(section('Other reports about this person', ctx.other_reports.length ? ctx.other_reports.map(function (o) { return el('p', { text: o.reason + ' - ' + o.content_type + ' - ' + o.status + ' (' + when(o.at) + ')' }); }) : [el('p', { class: 'muted', text: 'None' })]));
      d.appendChild(actionForm(row, who));
    } catch (e) { fail(e); }
  }

  function actionForm(row, who) {
    var action = el('select', { id: 'act' }, ['warn', 'remove_content', 'suspend', 'ban', 'restore', 'dismiss'].map(function (a) { return el('option', { value: a, text: a.replace('_', ' ') }); }));
    var days = el('input', { id: 'days', type: 'number', min: '1', max: '365', value: '7', 'aria-label': 'Suspension days' });
    var notes = el('textarea', { id: 'notes', rows: '3', placeholder: 'Why (kept in the record, and shown to the person only as a short notice)' });
    var go = el('button', { class: 'primary', text: 'Apply', onclick: async function () {
      var a = action.value, n = notes.value.trim();
      if (n.length < 5) { msg('Please write a short reason first.', true); return; }
      if ((a === 'ban' || a === 'restore') && !window.confirm('This is permanent until an admin reverses it. Continue?')) return;
      try {
        await rpc('mod_take_action', { p_report: row.report_id, p_target: who.id, p_action: a, p_notes: n, p_days: a === 'suspend' ? Number(days.value) : null });
        msg('Done: ' + a + '.', false); clear($('detail')); loadReports();
      } catch (e) { fail(e); }
    } });
    return section('Decide', [action, days, notes, go]);
  }

  async function loadAppeals() {
    try {
      var rows = await rpc('mod_appeals_queue', {});
      if (!rows.length) return empty('No open appeals.');
      rows.forEach(function (a) {
        function resolve(overturn) { return async function () {
          try { await rpc('mod_resolve_appeal', { p_appeal: a.appeal_id, p_overturn: overturn }); msg(overturn ? 'Overturned.' : 'Upheld.', false); show('appeals'); } catch (e) { fail(e); } }; }
        $('list').appendChild(el('div', { class: 'item' }, [
          el('strong', { text: (a.user_name || '(deleted)') + ' (' + a.user_state + ')' }),
          el('p', { text: a.message }),
          el('small', { text: 'Last action: ' + (a.last_action || '-') + (a.last_action_notes ? ' - ' + a.last_action_notes : '') + ' - ' + when(a.created_at) }),
          el('div', null, [el('button', { text: 'Overturn', onclick: resolve(true) }), el('button', { text: 'Uphold', onclick: resolve(false) })])
        ]));
      });
    } catch (e) { fail(e); }
  }

  async function loadPhotos() {
    try {
      var rows = await rpc('mod_photo_queue', { p_limit: 30 });
      if (!rows.length) return empty('No photos waiting.');
      rows.forEach(function (p) {
        var box = el('div', { class: 'photo' });
        function decide(approve) { return async function () {
          var why = $('why-' + p.photo_id).value.trim();
          if (!approve && why.length < 3) { msg('Please say briefly why it is not approved.', true); return; }
          try { await rpc('mod_review_photo', { p_photo: p.photo_id, p_approve: approve, p_notes: why || null }); show('photos'); } catch (e) { fail(e); } }; }
        var load = el('button', { text: 'Show photo', onclick: async function () {
          try {
            var r = await http('/v1/admin/photo-url', { photoId: p.photo_id });
            if (typeof r.url !== 'string' || r.url.indexOf(cfg.supabaseUrl + '/') !== 0) { msg('Unexpected photo link.', true); return; }
            clear(box); box.appendChild(el('img', { src: r.url, alt: 'Photo awaiting review' }));
          } catch (e) { fail(e); }
        } });
        $('list').appendChild(el('div', { class: 'item' }, [
          el('small', { text: 'Visible in: ' + (p.visible_modes || []).join(', ') + ' - uploaded ' + when(p.created_at) }), box, load,
          el('input', { id: 'why-' + p.photo_id, placeholder: 'Reason (required to reject)' }),
          el('button', { text: 'Approve', onclick: decide(true) }), el('button', { text: 'Reject', onclick: decide(false) })
        ]));
      });
    } catch (e) { fail(e); }
  }
})();
`;
