import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODES, NOTIFICATION_KINDS } from '@sidequest/shared';
import { describeNotification, KINDS_WITH_WORDING, sortInbox, unreadCount } from '../src/core/inbox-core.ts';
import { allowedSegments, NEW_SCREEN_SEGMENTS } from '../src/core/routing.ts';
import type { NotificationRow } from '../src/core/db-types.ts';

const U = '11111111-2222-4333-8444-555555555555';
const FULL = { inviteId: U, conversationId: U, openCallId: U, eventId: U, sessionId: U, circleId: U, checkinId: U, name: 'ZEDNAME', text: 'SECRETMESSAGE' };

test('every notification kind has inbox wording (and nothing extra)', () => {
  assert.deepEqual([...KINDS_WITH_WORDING].sort(), [...NOTIFICATION_KINDS].sort());
});
test('inbox wording never contains names, vibes or message text, even when the payload carries them', () => {
  const banned = [...Object.values(MODES).flatMap((m) => [m.label.toLowerCase(), m.id]), 'dating', 'hookup', 'flirt', 'couple', 'romantic'];
  for (const k of NOTIFICATION_KINDS) {
    const e = describeNotification(k, FULL); const text = `${e.title} ${e.body}`;
    assert.ok(!/ZEDNAME|SECRETMESSAGE/.test(text), `${k} leaks payload text`);
    for (const w of banned) assert.ok(!new RegExp(`\\b${w}\\b`, 'i').test(text), `${k} mentions ${w}`);
    assert.ok(e.title.length > 3 && e.body.length > 10);
  }
});
test('every route leads to a screen a signed-in person is allowed to open, and ids are validated', () => {
  const allowed = new Set(allowedSegments('/(tabs)/discover'));
  for (const k of NOTIFICATION_KINDS) {
    const r = describeNotification(k, FULL).route;
    if (r) assert.ok(allowed.has(r.replace(/^\//, '').split(/[/?]/)[0]!), `${k} -> ${r} is not an allowed segment`);
  }
  for (const s of NEW_SCREEN_SEGMENTS) assert.ok(allowed.has(s));
  assert.equal(describeNotification('invite_received', { inviteId: '../../etc/passwd' }).route, null);
  assert.equal(describeNotification('invite_received', {}).route, null);
  assert.equal(describeNotification('invite_received', null).route, null);
  assert.equal(describeNotification('message_received', FULL).route, `/chat/${U}`);
  assert.equal(describeNotification('game_invite', FULL).route, `/game/${U}?conversationId=${U}`);
  assert.equal(describeNotification('roulette_group_ready', { slot: 'x', activity: 'dinner' }).route, '/(tabs)/circles');
  assert.equal(describeNotification('open_call_accepted', { openCallId: U }).route, `/open-call/${U}`);
});
test('a kind this app version does not know still shows something harmless', () => {
  assert.deepEqual(describeNotification('brand_new_kind', { name: 'ZEDNAME' }), { title: 'Update', body: 'Open SideQuest to see what is new.', route: null });
});
test('inbox ordering: unanswered safety alerts first, then newest first; unread count', () => {
  const n = (id: string, kind: string, at: string, read: string | null = null): NotificationRow => ({ id, kind, payload: {}, read_at: read, created_at: at });
  const rows = [n('old-msg', 'message_received', '2026-11-01T00:00:00Z'), n('new-msg', 'message_received', '2026-11-05T00:00:00Z'), n('help', 'checkin_help', '2026-11-02T00:00:00Z'), n('help-read', 'checkin_help', '2026-11-04T00:00:00Z', 'x')];
  assert.deepEqual(sortInbox(rows).map((r) => r.id), ['help', 'new-msg', 'help-read', 'old-msg']);
  assert.equal(unreadCount(rows), 3);
});
