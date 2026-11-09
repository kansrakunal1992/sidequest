import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountLooksSuspicious, assessMessageText, describeAccountTrust } from '../src/index.ts';

const codes = (t: string, early = false) => assessMessageText(t, { earlyInConversation: early }).flags.map((f) => f.code).sort();

test('ordinary, friendly messages are never flagged', () => {
  for (const t of ['Hey! I love hiking, what about you?', 'Coffee on Saturday at 11? There is a nice place on Hancock Street', 'I work at the Cockpit Theatre, come see a show',
    'cumulative score was 7 out of 10 lol', 'My number of siblings is 3 and I am the youngest', 'Lunch costs about 15 dollars, split it?', 'See you at 7:30 near the station', 'I just got back from Instagram-worthy Lisbon haha', '']) {
    assert.deepEqual(codes(t), [], t); assert.equal(assessMessageText(t).level, 'none', t);
  }
  assert.equal(assessMessageText(null).level, 'none');
});
test('money requests are a warning, in many spellings', () => {
  for (const t of ['can you send me some money? it is an emergency', 'I need money for my flight, please transfer $500', 'buy me a g1ft card', 'please send a gift card code', 'send cash via Western Union',
    'my bank details are 1234 can you wire funds', 'pay me on cash app $moneyman']) {
    const a = assessMessageText(t); assert.equal(a.level, 'warning', t); assert.ok(a.flags.some((f) => f.code === 'money'), t);
  }
});
test('investment and crypto talk is a warning', () => { for (const t of ['I made a fortune with bitcoin, you should try', 'guaranteed returns on this trading platform', 'forex investment opportunity']) assert.ok(codes(t).includes('investment'), t); });
test('moving off the app, links and contact details are cautions, and become warnings very early in a chat', () => {
  assert.deepEqual(codes('add me on whatsapp'), ['off_platform']); assert.equal(assessMessageText('add me on whatsapp').level, 'caution');
  assert.ok(codes('check this https://bit.ly/abc').includes('link')); assert.ok(codes('visit myphotos.xyz').includes('link'));
  assert.ok(codes('call me +44 7700 900123').includes('contact_info')); assert.ok(codes('mail me at jo.smith@example.com').includes('contact_info'));
  const early = assessMessageText('text me on telegram', { earlyInConversation: true });
  assert.equal(early.level, 'warning'); assert.match(early.flags[0]!.title, /very early/);
});
test('pressure and classic romance-scam stories are flagged as cautions', () => {
  assert.ok(codes('I am deployed overseas and I love you already').includes('romance_scam'));
  assert.ok(codes('my late husband left me an inheritance').includes('romance_scam'));
  assert.ok(codes('do not tell anyone about us, keep this between us').includes('pressure'));
});
test('explicit content is a warning that sets the explicit flag, with advice to hide, report or block', () => {
  for (const t of ['send nudes', 'want a dick pic?', 'check my onlyfans', 'u wanna fuck me']) { const a = assessMessageText(t); assert.equal(a.explicit, true, t); assert.equal(a.level, 'warning', t); assert.match(a.flags.find((f) => f.code === 'explicit')!.advice, /report|block/); }
});
test('every flag explains itself in plain words and never accuses (uses "may" for explicit)', () => {
  const a = assessMessageText('send me money via whatsapp https://x.com and send nudes');
  for (const f of a.flags) { assert.ok(f.title.length > 6 && f.advice.length > 30); }
  assert.match(a.flags.find((f) => f.code === 'explicit')!.title, /May contain/);
});
test('account trust lines are factual: verified, new account, copy-paste messaging', () => {
  assert.deepEqual(describeAccountTrust({ verified: true, accountAgeDays: 90, repeatedMessageTo: 0 }).map((x) => x.label), ['Photo verified']);
  const l = describeAccountTrust({ verified: false, accountAgeDays: 1, repeatedMessageTo: 5 }); assert.deepEqual(l.map((x) => [x.label, x.tone]), [['Not photo verified', 'neutral'], ['Joined 1 day ago', 'warn'], ['Sent the same message to 5 people today', 'warn']]);
  assert.equal(describeAccountTrust({ verified: false, accountAgeDays: 0, repeatedMessageTo: 0 })[1]!.label, 'Joined today');
  assert.equal(accountLooksSuspicious({ verified: true, accountAgeDays: 300, repeatedMessageTo: 3 }), true);
  assert.equal(accountLooksSuspicious({ verified: false, accountAgeDays: 400, repeatedMessageTo: 1 }), false);
  assert.equal(accountLooksSuspicious({ verified: false, accountAgeDays: 1, repeatedMessageTo: 2 }), true);
});
