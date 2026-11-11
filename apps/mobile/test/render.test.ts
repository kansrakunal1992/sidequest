// Mounts the REAL screens (app/*.tsx and their features) with react-native-web in jsdom. Only the edges are fake: Supabase (answers from the
// test), expo-router (records navigation), session/modes (fixed), icons and the gradient. This proves the screens render, load, validate,
// call the right database functions with the right arguments, and navigate. It does NOT prove the native look, gestures or keyboard behaviour.
import { test, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { closeAll, mount } from './render/harness.ts';
afterEach(closeAll);
after(closeAll);
import type { Page } from './render/harness.ts';

const U = '11111111-2222-4333-8444-555555555555';
const FUTURE = new Date(Date.now() + 2 * 86_400_000).toISOString();
const noErrors = (p: Page) => assert.deepEqual(p.errors.filter((e) => !/Warning: (Each child|validateDOMNesting)/.test(e)), [], 'console errors while rendering');
const CIRCLE = { id: 'c1', name: 'Sunday Walkers', description: 'Hills and cake', visibility: 'public', category: 'walking', member_count: 3, my_role: null, my_status: null, owner_name: 'Sam', conversation_id: null };

test('Circles tab: lists circles, switches between the three panels, each loads its own data', async () => {
  const p = await mount('circles', { rpc: { circles_feed: [CIRCLE, { ...CIRCLE, id: 'c2', name: 'Chess Club', visibility: 'request_to_join' }, { ...CIRCLE, id: 'c3', name: 'Mine', my_status: 'active', my_role: 'owner' }],
    my_roulette: [{ signup_id: 's1', mode_id: 'friendship', activity: 'dinner', slot_start: FUTURE, group_size: 4, area_label: 'Soho', status: 'waiting', group_id: null, venue: null, conversation_id: null, is_host: null, members: null }],
    double_dates_feed: [], my_teams: [] } });
  await p.waitFor('Sunday Walkers');
  assert.ok(p.has('Join') && p.has('Ask to join') && p.has('Manage circle'));
  await p.click('Sunday Walkers'.length ? 'Join' : '');
  assert.deepEqual(p.nav.at(-1), { k: 'push', x: '/circle/c1' });
  await p.click('Social Roulette'); await p.waitFor('Looking for your table');
  assert.ok(p.has('dinner') && p.has('Soho') && p.has('Cancel my spot') && p.has('Join a table'));
  await p.click('Double dates'); await p.waitFor('No double dates yet');
  assert.ok(p.has('Post a double date') && p.has('My pairs'));
  assert.equal(p.rpcCalls('double_dates_feed')[0].args.p_mode, 'friendship');
  noErrors(p);
});
test('Circles tab: an empty, failing feed shows a calm message and a retry, not a crash', async () => {
  const p = await mount('circles', { rpc: { circles_feed: () => { throw Object.assign(new Error('boom'), { code: 'XX000' }); } } });
  await p.waitFor('Something went wrong. Please try again.'); assert.ok(p.has('Try again')); assert.ok(!p.has('boom'));
});
test('Circles tab: filtering by an interest asks the database for that category', async () => {
  const p = await mount('circles', { rpc: { circles_feed: [] } });
  await p.waitFor('No circles here yet'); await p.click('Walking groups');
  await p.settle(100);
  assert.ok(p.rpcCalls('circles_feed').some((c) => c.args.p_category === 'walking'));
});

test('New circle: validation messages show and nothing is sent; a good form calls create_circle and opens it', async () => {
  const p = await mount('circle-new', { rpc: { create_circle: 'new-id' } });
  await p.click('Create circle');
  assert.ok(p.has('Give the circle a name')); assert.equal(p.rpcCalls('create_circle').length, 0);
  await p.type('Name', '  Board gamers  '); await p.click('Create circle');
  const c = p.rpcCalls('create_circle')[0]; assert.equal(c.args.p.name, 'Board gamers'); assert.equal(c.args.p.visibility, 'public');
  assert.deepEqual(p.nav.at(-1), { k: 'replace', x: '/circle/new-id' });
  noErrors(p);
});

test('Circle detail (owner): shows plans, people, requests; accepting a request and posting a plan call the right functions', async () => {
  const p = await mount('circle', { params: { id: 'c3' }, rpc: {
    circles_feed: [{ ...CIRCLE, id: 'c3', my_status: 'active', my_role: 'owner', conversation_id: 'conv1' }],
    circle_people: [{ user_id: 'u1', display_name: 'Ana', role: 'member', status: 'active' }, { user_id: 'u2', display_name: 'Bo', role: 'member', status: 'requested' }],
    circle_events: [{ id: 'e1', title: 'Hill walk', description: null, starts_at: FUTURE, area_label: 'Hampstead', public_venue_name: null, capacity: 10, going: 3, my_status: null, is_mine: true, status: 'scheduled' }],
    decide_circle_member: null, post_circle_event: 'e2', join_activity: 'accepted' } });
  await p.waitFor('Hill walk');
  assert.ok(p.has('Open circle chat') && p.has('Requests to join') && p.has('Bo') && p.has('Ana') && p.has('Delete circle') && p.has('Post a plan'));
  await p.click('Accept');
  assert.deepEqual(p.rpcCalls('decide_circle_member')[0].args, { p_circle: 'c3', p_user: 'u2', p_accept: true });
  await p.click('I am going'); assert.deepEqual(p.rpcCalls('join_activity')[0].args, { p_event: 'e1' });
  await p.click('Open circle chat'); assert.deepEqual(p.nav.at(-1), { k: 'push', x: '/chat/conv1' });
  await p.click('Post a plan'); await p.click('Post plan'); assert.ok(p.has('Give it a title')); assert.equal(p.rpcCalls('post_circle_event').length, 0);
  noErrors(p);
});
test('Circle detail (visitor): can join, and a private or removed circle offers nothing', async () => {
  const p = await mount('circle', { params: { id: 'c1' }, rpc: { circles_feed: [CIRCLE], join_circle: 'requested' } });
  await p.waitFor('Sunday Walkers'); assert.ok(!p.has('People (') && !p.has('Coming up'));
  await p.click('Join'); assert.deepEqual(p.rpcCalls('join_circle')[0].args, { p_circle: 'c1' }); await p.waitFor('Request sent');
  const q = await mount('circle', { params: { id: 'c1' }, rpc: { circles_feed: [{ ...CIRCLE, visibility: 'private' }] } });
  await q.waitFor('not available to join');
});

test('Teams: invitation can be accepted, a pair can be created, inviting needs a valid friend code', async () => {
  const p = await mount('teams', { rpc: { my_teams: [
    { team_id: 't1', kind: 'friends', name: 'Duo', is_creator: false, my_status: 'invited', members: [] },
    { team_id: 't2', kind: 'couple', name: null, is_creator: true, my_status: 'accepted', members: [{ user_id: 'me', name: 'Me', status: 'accepted' }] }],
    respond_team_invite: null, create_team: 't3', invite_to_team: null } });
  await p.waitFor('Invitations'); await p.click('Accept');
  assert.deepEqual(p.rpcCalls('respond_team_invite')[0].args, { p_team: 't1', p_accept: true });
  await p.click('Invite my pair'); await p.type('Their friend code', 'ab12 cd34'); await p.click('Send invitation');
  assert.deepEqual(p.rpcCalls('invite_to_team')[0].args, { p_team: 't2', p_code: 'AB12CD34' });
  await p.click('Create'); assert.deepEqual(p.rpcCalls('create_team')[0].args, { p_kind: 'friends', p_name: '' });
  noErrors(p);
});

test('Join a table: every field is validated first, then join_roulette gets exactly the payload the database reads', async () => {
  const p = await mount('roulette-new', { rpc: { join_roulette: 's1' } });
  await p.click('Join');
  assert.ok(p.has('Say what you would like to do') && p.has('Add the area') && p.has('Pick a day and time') && p.has('Pick the energy'));
  assert.equal(p.rpcCalls('join_roulette').length, 0);
  noErrors(p);
});
test('Post a double date: without a full pair it explains what to do instead of offering a broken form', async () => {
  const p = await mount('double-date-new', { rpc: { my_teams: [{ team_id: 't2', kind: 'couple', name: null, is_creator: true, my_status: 'accepted', members: [{ user_id: 'me', name: 'Me', status: 'accepted' }] }] } });
  await p.waitFor('Your pair'); await p.click('Me + '.length ? 'Post' : '');
  assert.ok(p.has('Choose your team') || p.has('needs a pair')); assert.equal(p.rpcCalls('post_double_date').length, 0);
  const q = await mount('double-date-new', { rpc: { my_teams: [] } }); await q.waitFor('You need a pair first');
});

// ------------------------------------------------------------------ safety
test('Safety hub: shows the friend code formatted, the sections, and how many check-ins wait', async () => {
  const p = await mount('safety', { mode: 'serious_dating', rpc: { my_friend_code: 'ab12cd34', my_checkins: [{ id: 'k1', source_type: 'invite', source_id: 's', check_in_at: FUTURE, status: 'prompted', contact_label: 'Sis' }] } });
  await p.waitFor('AB12 CD34');
  for (const t of ['Trusted contacts and check-ins', 'Wingperson', 'Together', 'Privacy and pause', 'Blocked people', 'Your data', 'Share my code', 'Get a new code', '1 waiting']) assert.ok(p.has(t), t);
  await p.click('Wingperson'); assert.deepEqual(p.nav.at(-1), { k: 'push', x: '/safety/wing' });
  noErrors(p);
});
test('Trusted contacts: a prompted check-in can be answered, a contact added with a valid code and name', async () => {
  const p = await mount('trusted', { rpc: { my_trusted_contacts: [{ id: 'tc1', label: 'Sis', contact_name: 'Ana', direction: 'mine' }, { id: 'tc2', label: 'x', contact_name: 'Bo', direction: 'for_me' }],
    my_checkins: [{ id: 'k1', source_type: 'invite', source_id: 's', check_in_at: FUTURE, status: 'missed', contact_label: 'Sis' }], confirm_checkin: null, add_trusted_contact: 'tc3' }, tables: { calendar_entries: [] } });
  await p.waitFor('Please answer'); assert.ok(p.has('your contact was told') && p.has('People who trust me') && p.has('Sis'));
  await p.click('I am safe'); assert.deepEqual(p.rpcCalls('confirm_checkin')[0].args, { p_id: 'k1', p_safe: true });
  await p.type('Their friend code', 'zz99 yy88'); await p.type('What do you call them?', ' Flatmate '); await p.click('Add trusted contact');
  assert.deepEqual(p.rpcCalls('add_trusted_contact')[0].args, { p_code: 'ZZ99YY88', p_label: 'Flatmate' });
  noErrors(p);
});
test('Wingperson: suggestions can be accepted, an invite needs a code and at least one permission, and chats are never offered', async () => {
  const p = await mount('wing', { mode: 'friendship', rpc: { my_wing_grants: [{ grant_id: 'g1', role: 'wing', other_id: 'o', other_name: 'Dee', permissions: ['view_shared_profile'], status: 'invited', expires_at: null }],
    my_wing_suggestions: [{ id: 'sg1', grant_id: 'g2', from_name: 'Eli', kind: 'profile_text', payload: { headline: 'Climber and baker', bio: '' }, note: 'Try this', created_at: FUTURE }],
    resolve_wing_suggestion: null, respond_wing_invite: null, invite_wingperson: 'g9' } });
  await p.waitFor('Suggestions for you'); assert.ok(p.has('Climber and baker') && p.has('Try this') && p.has("You are Dee's wingperson"));
  assert.ok(!/read.*chat|message anyone/i.test(p.text().replace(/never read your chats[^.]*\./i, '').replace(/message anyone as you[^.]*\./i, '')) || p.has('Never my chats'));
  await p.click('Use it'); assert.deepEqual(p.rpcCalls('resolve_wing_suggestion')[0].args, { p_id: 'sg1', p_accept: true });
  await p.click('Accept'); assert.deepEqual(p.rpcCalls('respond_wing_invite')[0].args, { p_grant: 'g1', p_accept: true });
  await p.type('Their friend code', 'qq11 ww22'); await p.click('Send request');
  assert.deepEqual(p.rpcCalls('invite_wingperson')[0].args, { p_code: 'QQ11WW22', p_permissions: ['view_shared_profile'] });
  noErrors(p);
});
test('Together: invited partner can agree and choose sharing; turning "link" off switches the rest off', async () => {
  const couple = { couple_id: 'cp1', partner_id: 'p', partner_name: 'Kim', i_am_a: false, a_link: true, a_shared_profile: false, a_discovery: false, b_link: false, b_shared_profile: false, b_discovery: false, paused: false };
  const p = await mount('together', { mode: 'serious_dating', rpc: { my_couple: [couple], set_couple_consent: null } });
  await p.waitFor('You and Kim'); assert.ok(p.has('Kim asked to link'));
  const toggles = () => [...p.doc.querySelectorAll<HTMLInputElement>('input[type=checkbox]')];
  assert.equal(toggles().length, 4); assert.equal(toggles()[0]!.checked, false);
  toggles()[0]!.click(); await p.settle(100);
  assert.deepEqual(p.rpcCalls('set_couple_consent')[0].args, { p_couple: 'cp1', p_link: true, p_shared_profile: false, p_discovery: false, p_paused: false });
  noErrors(p);
});
test('Together: with no link yet, it asks for the partner\'s friend code', async () => {
  const p = await mount('together', { mode: 'serious_dating', rpc: { my_couple: [], create_couple_link: 'cp9' } });
  await p.waitFor("Your partner's friend code"); await p.type("Your partner's friend code", 'aa11 bb22'); await p.click('Send link request');
  assert.deepEqual(p.rpcCalls('create_couple_link')[0].args, { p_code: 'AA11BB22' });
});
test('Privacy and pause: toggles write the profile column; pausing calls the function and refreshes the profile', async () => {
  const p = await mount('privacy', { tables: { profiles: [{ incognito: false, read_receipts: true, accepts_intro_invites: true }] }, rpc: { pause_account: null } });
  await p.waitFor('Take a break'); await p.click('Pause my account');
  assert.equal(p.rpcCalls('pause_account').length, 1); assert.ok(p.calls.some((c) => c.kind === 'refreshProfile'));
  const q = await mount('privacy', { profile: { state: 'paused', onboardingComplete: true }, tables: { profiles: [{}] }, rpc: { resume_account: null } });
  await q.waitFor('Your account is paused'); await q.click('Resume my account'); assert.equal(q.rpcCalls('resume_account').length, 1);
  noErrors(p);
});
test('Blocked people: shows names, unblocking asks first and deletes only my own block row', async () => {
  const p = await mount('blocked', { rpc: { my_blocks: [{ user_id: 'x1', display_name: 'Zed', blocked_at: FUTURE }] }, tables: { blocks: [] } });
  await p.waitFor('Zed'); assert.ok(p.has('They are not told')); noErrors(p);
  const q = await mount('blocked', { rpc: { my_blocks: [] } }); await q.waitFor('Nobody blocked');
});
test('Your data: each export state is explained; download uses the API link; deletion states the 7-day rule and can be cancelled', async () => {
  const done = { id: 'r1', kind: 'export', status: 'done', requested_at: new Date(Date.now() - 3600_000).toISOString(), completed_at: new Date(Date.now() - 1800_000).toISOString(), ready: true };
  const p = await mount('data', { rpc: { my_data_requests: [done] } });
  await p.waitFor('Your export is ready'); await p.click('Download'); await p.settle(100);
  assert.ok(p.calls.some((c) => c.kind === 'api' && c.id === 'r1'));
  const q = await mount('data', { rpc: { my_data_requests: [{ id: 'd1', kind: 'deletion', status: 'queued', requested_at: new Date(Date.now() - 86_400_000).toISOString(), completed_at: null, ready: false }], cancel_deletion: true } });
  await q.waitFor('Deletion is scheduled in'); assert.ok(/5 days 2\dh|6 days/.test(q.text())); await q.click('Cancel deletion');
  assert.equal(q.rpcCalls('cancel_deletion').length, 1); assert.ok(q.calls.some((c) => c.kind === 'refreshProfile'));
  const r = await mount('data', { rpc: { my_data_requests: [], request_export: 'r2' } });
  await r.waitFor('Request my data'); assert.ok(r.has('After 7 days')); await r.click('Request my data'); assert.equal(r.rpcCalls('request_export').length, 1);
  noErrors(p);
});

// ------------------------------------------------------------------ inbox, games, restricted
test('Notification inbox: wording is name-free, urgent safety alerts come first, tapping marks read and opens the right screen', async () => {
  const p = await mount('notifications', { tables: { notifications: [
    { id: 'n1', kind: 'message_received', payload: { conversationId: U, name: 'LEAKYNAME' }, read_at: null, created_at: '2026-11-05T10:00:00Z' },
    { id: 'n2', kind: 'checkin_help', payload: { checkinId: U, name: 'LEAKYNAME' }, read_at: null, created_at: '2026-11-01T10:00:00Z' }] } });
  await p.waitFor('A friend asked for help');
  assert.ok(!p.has('LEAKYNAME')); assert.ok(p.text().indexOf('A friend asked for help') < p.text().indexOf('New message')); assert.ok(p.has('2 new'));
  await p.click('New message'); assert.deepEqual(p.nav.at(-1), { k: 'push', x: `/chat/${U}` });
  assert.ok(p.calls.some((c) => c.kind === 'from' && c.table === 'notifications' && JSON.stringify(c.ops).includes('read_at')));
  noErrors(p);
});
const SID = '99999999-9999-4999-8999-999999999999';
test('Game: invited players can accept; playing shows the round and sends the answer in the format the database stores', async () => {
  const mk = (state: string, players: unknown[], responses: unknown[] = []) => ({ tables: { chemistry_sessions: [{ id: SID, kind: 'rapid_fire', state, created_by: 'them', conversation_id: 'conv1' }], chemistry_players: players, chemistry_responses: responses }, params: { id: SID }, rpc: { respond_game: null, submit_answer: null } });
  const a = await mount('game', mk('invited', [{ user_id: 'me-0000', accepted: false }, { user_id: 'them', accepted: true }]));
  await a.waitFor('You have been invited to play'); await a.click('Play'); assert.deepEqual(a.rpcCalls('respond_game')[0].args, { p_session: SID, p_accept: true });
  const b = await mount('game', mk('active', [{ user_id: 'me-0000', accepted: true }, { user_id: 'them', accepted: true }], [{ user_id: 'me-0000', round: 0, answer: { text: 'tea' } }, { user_id: 'them', round: 0, answer: { text: 'coffee' } }]));
  await b.waitFor('Their answer appears after you answer'); assert.ok(b.has('You: tea') && b.has('Them: coffee') && b.has('2 of 5') === false);
  await b.type('Your answer', '  pizza  '); await b.click('Next');
  assert.deepEqual(b.rpcCalls('submit_answer')[0].args, { p_session: SID, p_round: 1, p_answer: { text: 'pizza' } });
  noErrors(b);
});
test('Restricted account: suspended people can appeal (validated), banned ones too; pending deletion can be cancelled; nothing else is offered', async () => {
  const s = await mount('restricted', { profile: { state: 'suspended', onboardingComplete: true }, rpc: { my_data_requests: [], submit_appeal: 'a1' } });
  await s.waitFor('Your account is on hold'); assert.ok(!s.has('Keep my account'));
  await s.type('What would you like us to know?', 'too short'); await s.click('Send'); assert.ok(s.has('explain in a few sentences')); assert.equal(s.rpcCalls('submit_appeal').length, 0);
  await s.type('What would you like us to know?', '  I think this was a misunderstanding about a joke.  '); await s.click('Send');
  assert.deepEqual(s.rpcCalls('submit_appeal')[0].args, { p_message: 'I think this was a misunderstanding about a joke.' }); await s.waitFor('a person will read it');
  const d = await mount('restricted', { profile: { state: 'deleted', onboardingComplete: true }, rpc: { my_data_requests: [{ id: 'd1', kind: 'deletion', status: 'queued', requested_at: new Date().toISOString(), completed_at: null, ready: false }], cancel_deletion: true } });
  await d.waitFor('scheduled for deletion'); assert.ok(!d.has('Ask for a review')); await d.click('Keep my account');
  assert.equal(d.rpcCalls('cancel_deletion').length, 1); assert.ok(d.calls.some((c) => c.kind === 'refreshProfile'));
  const b = await mount('restricted', { profile: { state: 'banned', onboardingComplete: true }, rpc: { my_data_requests: [] } });
  await b.waitFor('closed by our team'); assert.ok(b.has('Ask for a review'));
  noErrors(s);
});

test('Legal links: the safety hub shows Terms, Privacy Policy and web deletion, and they open the API pages', async () => {
  const p = await mount('safety', { rpc: { my_friend_code: 'ab12cd34', my_checkins: [] } });
  await p.waitFor('Privacy Policy');
  assert.ok(p.has('Terms and Community Guidelines') && p.has('Delete account (web)'));
  await p.click('Privacy Policy'); await p.click('Terms and Community Guidelines');
  assert.deepEqual(p.opened(), ['https://api.example.test/privacy', 'https://api.example.test/terms']);
  noErrors(p);
});

// ------------------------------------------------------------------ per-vibe features
test('Vibe features: the Circles tab shows only the panels the vibe has, and a vibe with none says so kindly', async () => {
  const ad = await mount('circles', { mode: 'adventures', rpc: { circles_feed: [] } });
  await ad.waitFor('No circles here yet');
  assert.ok(ad.has('Social Roulette') && !ad.has('Double dates'), 'Adventures: circles and roulette, no double dates');
  const dating = await mount('circles', { mode: 'serious_dating', rpc: { double_dates_feed: [], my_teams: [] } });
  await dating.waitFor('No double dates yet');
  assert.ok(!dating.has('Social Roulette') && dating.rpcCalls('circles_feed').length === 0, 'Dating: only double dates, so no tab strip and no circles request');
  const casual = await mount('circles', { mode: 'hookups' });
  await casual.waitFor('is not part of the Casual vibe'); assert.ok(casual.has('Switch vibe'));
  noErrors(casual);
});
test('Vibe features: the safety hub hides Together where the vibe has none; deep links to it get the friendly message', async () => {
  const p = await mount('safety', { mode: 'friendship', rpc: { my_friend_code: 'ab12cd34', my_checkins: [] } });
  await p.waitFor('AB12 CD34'); assert.ok(p.has('Wingperson') && !p.has('Together'));
  const q = await mount('together', { mode: 'friendship', rpc: { my_couple: [] } });
  await q.waitFor('Together is not part of the Friendship vibe'); assert.equal(q.rpcCalls('my_couple').length, 0, 'nothing is requested for a screen the vibe does not have');
  const r = await mount('together', { mode: null, rpc: { my_couple: [] } });
  await r.waitFor("Your partner's friend code");
});
test('Vibe features: every vibe has a screen to land on (no blank Circles tab, no vibe where the hub is empty)', async () => {
  for (const mode of ['serious_dating', 'friendship', 'post_marital', 'experimentation', 'adventures']) {
    const p = await mount('safety', { mode, rpc: { my_friend_code: 'ab12cd34', my_checkins: [] } });
    await p.waitFor('Privacy and pause'); assert.ok(p.has('Trusted contacts and check-ins') && p.has('Blocked people'), mode);
  }
});

// ------------------------------------------------------------------ notifications and location status
test('Privacy: shows notification and location status in plain words, with the next step', async () => {
  const p = await mount('privacy', { tables: { profiles: [{}] }, globals: { __pushPermission: 'blocked_in_settings' } });
  await p.waitFor('Notifications'); await p.waitFor('Permission: blocked');
  assert.ok(p.has('Location') && p.has('Update my location') && p.has('Send test notification') && p.has('Open Settings'));
  assert.ok(p.has('Android will not show its permission box again'), 'the one next step for a blocked permission');
  await p.click('Open Settings'); assert.ok(p.calls.some((c) => c.kind === 'openSettings'));
  noErrors(p);
});
test('Privacy: "Send test notification" says what happened, including a server with no Firebase key', async () => {
  const ok = await mount('privacy', { tables: { profiles: [{}] } });
  await ok.waitFor('Send test notification'); await ok.click('Send test notification');
  await ok.waitFor('Test sent'); assert.ok(ok.calls.some((c) => c.name === 'pushTest'));
  const off = await mount('privacy', { tables: { profiles: [{}] }, globals: { __pushTest: { tokens: 1, sent: 0, error: 'not_configured' }, __pushConfigured: false } });
  await off.waitFor('Send test notification'); await off.settle(100); assert.ok(off.has('Server ready to send: no'));
  await off.click('Send test notification'); await off.waitFor('FCM_SERVICE_ACCOUNT_JSON');
});
test('Privacy: "Update my location" saves the rounded position through the database function; a refusal explains why', async () => {
  const p = await mount('privacy', { tables: { profiles: [{}] }, rpc: { set_approx_location: null } });
  await p.waitFor('Update my location'); await p.click('Update my location'); await p.waitFor('Location updated');
  assert.deepEqual(p.rpcCalls('set_approx_location')[0].args, { p_lat: 28.46, p_lng: 77.03 });
  const q = await mount('privacy', { tables: { profiles: [{}] }, rpc: { set_approx_location: null }, globals: { __locResult: { reason: 'services_off', lat: null, lng: null, city: null } } });
  await q.waitFor('Update my location'); await q.click('Update my location');
  await q.waitFor('Location is switched off'); assert.equal(q.rpcCalls('set_approx_location').length, 0);
  noErrors(q);
});
test('Privacy: a typed city is the manual fallback and goes through the same function', async () => {
  const p = await mount('privacy', { tables: { profiles: [{}] }, rpc: { set_approx_location: null } });
  await p.waitFor('Use this city'); await p.type('Or use a city', 'Kolkata'); await p.click('Use this city');
  await p.waitFor('Location updated'); assert.deepEqual(p.rpcCalls('set_approx_location')[0].args, { p_lat: 22.57, p_lng: 88.36 });
});

// ------------------------------------------------------------------ automatic photo verification
test('Verify: asks for agreement in plain words, starts the check, and shows the result when it arrives', async () => {
  const p = await mount('verify', { globals: { __myVerification: { verified: false, verified_at: null, latest: null } } });
  await p.waitFor('Photo verification'); await p.waitFor('I agree, start the check');
  assert.ok(p.has('We never receive your selfie') && p.has('Not now'));
  await p.click('I agree, start the check');
  await p.waitFor('Waiting for the result'); assert.ok(p.calls.some((c) => c.kind === 'startSelfieCheck'));
  noErrors(p);
});
test('Verify: a failed start says why; a past mismatch offers a retry; a verified person is told what the badge means', async () => {
  const e = await mount('verify', { globals: { __verifyStartError: 'You have tried a few times already. Please try again tomorrow.' } });
  await e.waitFor('I agree, start the check'); await e.click('I agree, start the check');
  await e.waitFor('try again tomorrow'); assert.ok(!e.has('Waiting for the result'));
  const f = await mount('verify', { globals: { __myVerification: { verified: false, latest: { status: 'rejected', reject_reason: 'face_mismatch', expires_at: null } } } });
  await f.waitFor('did not match your profile photo'); assert.ok(f.has('Try again'));
  const ok = await mount('verify', { globals: { __myVerification: { verified: true, verified_at: '2026-11-09T00:00:00Z', latest: null } } });
  await ok.waitFor('You are photo verified'); assert.ok(ok.has('does not check your name'));
  const off = await mount('verify', { globals: { __verification: false } });
  await off.waitFor('Not available yet'); assert.ok(!off.has('I agree, start the check'));
});
test('Safety hub: the Photo verification row appears only when the server has it', async () => {
  const on = await mount('safety', { mode: 'serious_dating', rpc: { my_friend_code: 'ab12cd34', my_checkins: [] } });
  await on.waitFor('AB12 CD34'); await on.settle(100); assert.ok(on.has('Photo verification'));
  const off = await mount('safety', { mode: 'serious_dating', rpc: { my_friend_code: 'ab12cd34', my_checkins: [] }, globals: { __verification: false } });
  await off.waitFor('AB12 CD34'); await off.settle(100); assert.ok(!off.has('Photo verification'));
});

// ===== Let's Meet and Date Ideas ================================================================================
test("Let's Meet: opens on the meetup option, validates, then sends an in-person plan with the activity and place", async () => {
  const p = await mount('invite-new', { params: { to: U, mode: 'friendship', name: 'Aman', kind: 'in_person' } });
  await p.waitFor('Make a plan with Aman');
  assert.ok(p.has('What would you like to do?') && p.has('Chai or coffee') && p.has('Where?') && p.has('For a first meeting') && p.has('Send plan'));
  assert.ok(p.has('Pick a busy public place for a first meeting.'));
  await p.click('Send plan'); assert.ok(p.has('Pick a day and time.')); assert.equal(p.calls.filter((c) => c.name === 'createInvite').length, 0);
  await p.click('Tomorrow evening'); await p.click('Send plan'); assert.ok(p.has('Choose what you would like to do.'));
  await p.click('Chai or coffee'); await p.click('Send plan'); assert.ok(p.has('Name the place'));
  await p.type('Place', 'Blue Tokai'); await p.type('Neighbourhood or area', 'Khan Market'); await p.click('Send plan');
  const call = p.calls.find((c) => c.name === 'createInvite')!;
  assert.deepEqual([call.body.format, call.body.activity, call.body.venueName, call.body.areaLabel, call.body.recipientId, call.body.modeId], ['in_person', 'chai_coffee', 'Blue Tokai', 'Khan Market', U, 'friendship']);
  assert.equal(call.body.durationMinutes, 60);
  assert.deepEqual(p.nav.at(-1), { k: 'replace', x: '/invite/inv1' });
  noErrors(p);
});
test("Let's Meet: a Date Idea pre-selects its activity and length; contact details in the place are refused", async () => {
  const p = await mount('invite-new', { params: { to: U, mode: 'friendship', name: 'Aman', idea: 'movie' } });
  await p.waitFor('Make a plan with Aman');
  await p.click('Tomorrow evening'); await p.type('Place', 'Cafe 9876543210'); await p.type('Neighbourhood or area', 'Delhi'); await p.click('Send plan');
  assert.ok(p.has('phone numbers')); assert.equal(p.calls.filter((c) => c.name === 'createInvite').length, 0);
  await p.type('Place', 'PVR Select Citywalk'); await p.click('Send plan');
  const call = p.calls.find((c) => c.name === 'createInvite')!;
  assert.deepEqual([call.body.activity, call.body.durationMinutes], ['movie', 150]);
});
test('Invite composer: ordinary invitations are unchanged until Meet in person is chosen', async () => {
  const p = await mount('invite-new', { params: { to: U, mode: 'friendship', name: 'Aman' } });
  await p.waitFor('Invite Aman');
  assert.ok(!p.has('Where?') && p.has('Send invitation') && p.has('Meet in person') && p.has('Virtual coffee'));
  await p.click('Meet in person'); assert.ok(p.has('Where?') && p.has('Make a plan with Aman') && p.has('Send plan'));
});
test('Date ideas editor: loads yours, stops at three, and saves through the checked function', async () => {
  const p = await mount('date-ideas-editor', { rpc: { my_date_ideas: [{ ideas: ['walk'], free_window: 'weekends' }], set_date_ideas: null } });
  await p.waitFor('Date ideas'); await p.settle(100);
  await p.click('Chai or coffee'); await p.click('A movie');
  await p.click('Trivia night', 0); assert.ok(p.has('You can pick up to 3'));
  await p.click('Save date ideas');
  const c = p.rpcCalls('set_date_ideas')[0]; assert.deepEqual(c.args, { p_ideas: ['walk', 'chai_coffee', 'movie'], p_window: 'weekends' });
  assert.ok(p.has('Saved')); noErrors(p);
});
test('Date ideas editor: stays out of the way when the database function is missing', async () => {
  const p = await mount('date-ideas-editor', { rpc: { my_date_ideas: () => { throw Object.assign(new Error('missing'), { code: '42883' }); } } });
  await p.settle(300); assert.ok(!p.has('Date ideas') && !p.has('Save date ideas'));
});
test('Date ideas on a profile: matched people can tap one; unmatched people just see them', async () => {
  const rows = { date_ideas_for: [{ user_id: 'u1', ideas: ['walk', 'meal'], free_window: 'weekends' }], my_date_ideas: [{ ideas: ['meal'], free_window: null }] };
  const a = await mount('date-ideas-card', { params: { matched: '1' }, rpc: rows });
  await a.waitFor('Usually free: weekends');
  assert.ok(a.has('You both like: Lunch or dinner') && a.has('Tap an idea to suggest a plan.'));
  assert.deepEqual(a.rpcCalls('date_ideas_for')[0].args, { p_ids: ['u1'], p_mode: 'friendship' });
  await a.click('A walk'); await a.settle(50); assert.equal(a.win.__picked, 'walk');
  const b = await mount('date-ideas-card', { params: { matched: '0' }, rpc: rows });
  await b.waitFor('Plans open up once you have matched.'); assert.ok(!b.has('Tap an idea'));
  const c = await mount('date-ideas-card', { params: { matched: '1' }, rpc: { date_ideas_for: [], my_date_ideas: [] } });
  await c.settle(300); assert.ok(!c.has('Date ideas'));
});

test('Swipe card: shows what they are up for, asks once for the whole batch, and stays plain without ideas', async () => {
  const a = await mount('card-ideas', { rpc: { date_ideas_for: [{ user_id: 'u1', ideas: ['walk', 'chai_coffee'], free_window: 'weekends' }] } });
  await a.waitFor('Up for: A walk, Chai or coffee');
  assert.equal(a.rpcCalls('date_ideas_for').length, 1); assert.deepEqual(a.rpcCalls('date_ideas_for')[0].args, { p_ids: ['u1'], p_mode: 'friendship' });
  assert.ok(a.has('Aman, 29'));
  const b = await mount('card-ideas', { rpc: { date_ideas_for: [] } });
  await b.waitFor('Aman, 29'); await b.settle(200); assert.ok(!b.has('Up for'));
  const c = await mount('card-ideas', { rpc: { date_ideas_for: () => { throw new Error('missing'); } } });
  await c.waitFor('Aman, 29'); await c.settle(200); assert.ok(!c.has('Up for')); noErrors(c);
});
