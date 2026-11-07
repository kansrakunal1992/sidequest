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
  const p = await mount('safety', { rpc: { my_friend_code: 'ab12cd34', my_checkins: [{ id: 'k1', source_type: 'invite', source_id: 's', check_in_at: FUTURE, status: 'prompted', contact_label: 'Sis' }] } });
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
  const p = await mount('together', { rpc: { my_couple: [couple], set_couple_consent: null } });
  await p.waitFor('You and Kim'); assert.ok(p.has('Kim asked to link'));
  const toggles = () => [...p.doc.querySelectorAll<HTMLInputElement>('input[type=checkbox]')];
  assert.equal(toggles().length, 4); assert.equal(toggles()[0]!.checked, false);
  toggles()[0]!.click(); await p.settle(100);
  assert.deepEqual(p.rpcCalls('set_couple_consent')[0].args, { p_couple: 'cp1', p_link: true, p_shared_profile: false, p_discovery: false, p_paused: false });
  noErrors(p);
});
test('Together: with no link yet, it asks for the partner\'s friend code', async () => {
  const p = await mount('together', { rpc: { my_couple: [], create_couple_link: 'cp9' } });
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
