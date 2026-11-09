import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bannerText, incomingWarnings, parseTrust, startsHidden, trustCard } from '../src/core/trust-ui.ts';
import type { MessageLike } from '../src/core/trust-ui.ts';

const ME = 'me', THEM = 'them';
const msg = (id: string, from: string, body: string | null, mediaKind: string | null = null): MessageLike => ({ id, senderId: from, body, mediaKind });

test('only messages I RECEIVED are judged; my own, images and ordinary chat are left alone', () => {
  const w = incomingWarnings([msg('1', THEM, 'Hi, how was your weekend?'), msg('2', ME, 'send me money lol'), msg('3', THEM, null, 'image'), msg('4', THEM, 'Can you send me a gift card? It is urgent')], ME);
  assert.deepEqual([...w.keys()], ['4']);
  assert.equal(w.get('4')!.level, 'warning');
});

test('moving to another app is a stronger warning early in the chat than later', () => {
  const early = incomingWarnings([msg('1', THEM, 'add me on whatsapp')], ME).get('1')!;
  assert.equal(early.level, 'warning');
  const filler = Array.from({ length: 8 }, (_, i) => msg(`f${i}`, i % 2 ? ME : THEM, 'ok'));
  const late = incomingWarnings([...filler, msg('x', THEM, 'add me on whatsapp')], ME).get('x')!;
  assert.equal(late.level, 'caution');
});

test('explicit text starts hidden; scam cues do not', () => {
  const w = incomingWarnings([msg('1', THEM, 'send nudes'), msg('2', THEM, 'send money now, urgent, bank transfer')], ME);
  assert.equal(startsHidden(w.get('1')!), true);
  assert.equal(startsHidden(w.get('2')!), false);
});

test('banner text leads with the most serious flag and lists the rest', () => {
  const w = incomingWarnings([msg('1', THEM, 'Invest in bitcoin, see https://x.io/win and send money to my bank account')], ME).get('1')!;
  const b = bannerText(w);
  assert.ok(['Asks for money or gifts', 'Talks about investing or crypto'].includes(b.title));
  assert.ok(b.advice.length > 20 && b.more.length >= 1);
});

test('while the server has no selfie verification, no "verified" or "not verified" wording appears in the card', () => {
  const c = trustCard({ verified: false, accountAgeDays: 40, repeatedMessageTo: 0 });
  assert.deepEqual(c.lines, []);
  assert.equal(c.suspicious, false);
  const fresh = trustCard({ verified: false, accountAgeDays: 0, repeatedMessageTo: 4 });
  assert.deepEqual(fresh.lines.map((l) => l.label), ['Joined today', 'Sent the same message to 4 people today']);
  assert.equal(fresh.suspicious, true);
  for (const l of fresh.lines) assert.ok(!/verified/i.test(`${l.label} ${l.detail}`));
  // once the server reports verification is on, the honest "not verified" line returns
  assert.ok(trustCard({ verified: false, accountAgeDays: 40, repeatedMessageTo: 0 }, true).lines.some((l) => /not photo verified/i.test(l.label)));
  assert.ok(trustCard({ verified: true, accountAgeDays: 40, repeatedMessageTo: 0 }, true).lines.some((l) => /photo verified/i.test(l.label)));
  assert.deepEqual(trustCard(null), { lines: [], suspicious: false });
});

test('the database answer is parsed defensively', () => {
  assert.deepEqual(parseTrust({ verified: false, account_age_days: 3, repeated_message_to: 1 }), { verified: false, accountAgeDays: 3, repeatedMessageTo: 1 });
  assert.deepEqual(parseTrust({ verified: true, account_age_days: -2.7, repeated_message_to: 0 }), { verified: true, accountAgeDays: 0, repeatedMessageTo: 0 });
  for (const bad of [null, undefined, 'x', {}, { account_age_days: 'a', repeated_message_to: 1 }]) assert.equal(parseTrust(bad), null);
});
