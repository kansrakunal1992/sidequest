import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNotifier, NoopPushSender } from '../src/notifications.ts';
import { DATA_REQUEST_MAX_ATTEMPTS, DATA_REQUEST_RETRY_MIN, DELETION_GRACE_DAYS, EXPORT_LINK_DAYS, processDeletions, processExports, purgeExpiredExports } from '../src/jobs.ts';
import { FakeAdmin } from './fake-admin.ts';
import { A, B, T0, setup } from './helpers.ts';

function dataSetup() {
  const s = setup();
  const admin = new FakeAdmin();
  const notifier = createNotifier({ store: s.store, sender: new NoopPushSender(), clock: s.clock });
  const logs: string[] = [];
  const deps = { store: s.store, notifier, clock: s.clock, admin, log: (m: string) => logs.push(m) };
  const req = (o: Record<string, unknown> = {}) => {
    const r = { id: `r${s.store.dataRequests.length + 1}`, userId: A, kind: 'export' as const, status: 'queued', requestedAt: T0, claimedAt: null, attempts: 0, resultPath: null, completedAt: null, lastError: null, ...o };
    s.store.dataRequests.push(r as never); return r;
  };
  return { ...s, admin, deps, logs, req };
}
const day = (n: number) => n * 86_400_000;

test('export: builds the file in the person\'s own folder, marks it done, and tells them', async () => {
  const { deps, store, admin, req } = dataSetup();
  const r = req();
  assert.deepEqual(await processExports(deps), { done: 1, failed: 0 });
  assert.equal(r.status, 'done'); assert.equal(r.resultPath, `${A}/r1.json`);
  assert.deepEqual(JSON.parse(admin.files.get(`exports/${A}/r1.json`)!), { profile: { id: A } });
  const n = store.notifications.filter((x) => x.kind === 'export_ready');
  assert.equal(n.length, 1); assert.equal(n[0]!.userId, A);
  assert.deepEqual(await processExports(deps), { done: 0, failed: 0 });                    // nothing left; never redone
});

test('export: a failure is retried, then given up after the attempt limit with the error recorded', async () => {
  const { deps, admin, req, setTime, at } = dataSetup();
  const r = req();
  admin.failNext = { op: 'upload', times: 99 };
  for (let i = 1; i < DATA_REQUEST_MAX_ATTEMPTS; i += 1) {
    setTime(at(i * (DATA_REQUEST_RETRY_MIN + 1))); await processExports(deps); assert.equal(r.status, 'queued'); assert.equal(r.attempts, i);
    assert.deepEqual(await processExports(deps), { done: 0, failed: 0 });            // same minute: not retried in a tight loop
  }
  setTime(at(DATA_REQUEST_MAX_ATTEMPTS * (DATA_REQUEST_RETRY_MIN + 1)));
  await processExports(deps);
  assert.equal(r.status, 'failed'); assert.equal(r.attempts, DATA_REQUEST_MAX_ATTEMPTS); assert.match(r.lastError!, /upload_boom/);
  assert.deepEqual(await processExports(deps), { done: 0, failed: 0 });                    // a failed request is not picked up again
});

test('export: a request stuck "processing" by a crashed worker is picked up again', async () => {
  const { deps, setTime, at, req } = dataSetup();
  const r = req({ status: 'processing', claimedAt: at(0), attempts: 1 });
  setTime(at(10)); assert.equal((await processExports(deps)).done, 0);                      // claimed 10 minutes ago: still someone's
  setTime(at(45)); assert.equal((await processExports(deps)).done, 1);
  assert.equal(r.status, 'done');
});

test('deletion: nothing happens before 7 days; after that files, then the login account, are removed', async () => {
  const { deps, admin, store, setTime, req } = dataSetup();
  const r = req({ kind: 'deletion' });
  admin.authUsers.add(A);
  admin.files.set(`profile-photos/${A}/a.jpg`, 'x'); admin.files.set(`chat-media/${A}/c/1.jpg`, 'x'); admin.files.set(`exports/${A}/old.json`, 'x');
  admin.files.set(`profile-photos/${B}/b.jpg`, 'keep');
  setTime(new Date(T0.getTime() + day(DELETION_GRACE_DAYS) - 1000));
  assert.deepEqual(await processDeletions(deps), { done: 0, failed: 0 });
  assert.equal(admin.files.size, 4);
  setTime(new Date(T0.getTime() + day(DELETION_GRACE_DAYS)));
  assert.deepEqual(await processDeletions(deps), { done: 1, failed: 0 });
  assert.deepEqual([...admin.files.keys()], [`profile-photos/${B}/b.jpg`]);                // only A's files; B's are untouched
  assert.ok(!admin.authUsers.has(A));
  const order = admin.calls.filter((c) => c.startsWith('clear') || c.startsWith('deleteUser'));
  assert.equal(order.at(-1), `deleteUser ${A}`);                                             // files first, account last
  assert.equal(r.status, 'done');
  void store;
});

test('deletion: a cancelled request is never executed', async () => {
  const { deps, admin, setTime, req } = dataSetup();
  const r = req({ kind: 'deletion', status: 'cancelled' });
  setTime(new Date(T0.getTime() + day(30)));
  assert.deepEqual(await processDeletions(deps), { done: 0, failed: 0 });
  assert.equal(admin.calls.length, 0); assert.equal(r.status, 'cancelled');
});

test('deletion: if removing the account fails it is retried, files already gone is fine, and giving up is loudly logged', async () => {
  const { deps, admin, logs, setTime, req } = dataSetup();
  const r = req({ kind: 'deletion' });
  let t = T0.getTime() + day(8); const later = () => { t += (DATA_REQUEST_RETRY_MIN + 1) * 60_000; setTime(new Date(t)); };
  setTime(new Date(t));
  admin.failNext = { op: 'deleteUser', times: 2 };
  await processDeletions(deps); assert.equal(r.status, 'queued');
  assert.deepEqual(await processDeletions(deps), { done: 0, failed: 0 });            // too soon to retry
  later(); await processDeletions(deps); assert.equal(r.status, 'queued');
  later(); assert.deepEqual(await processDeletions(deps), { done: 1, failed: 0 }); assert.equal(r.status, 'done');
  const r2 = req({ kind: 'deletion' });
  admin.failNext = { op: 'deleteUser', times: 99 };
  for (let i = 0; i < DATA_REQUEST_MAX_ATTEMPTS; i += 1) { later(); await processDeletions(deps); }
  assert.equal(r2.status, 'failed'); assert.ok(logs.some((l) => l.startsWith('ALERT:')));
});

test('export files are removed from storage after the link period', async () => {
  const { deps, admin, setTime, req } = dataSetup();
  const r = req({ status: 'done', resultPath: `${A}/r1.json`, completedAt: T0 });
  admin.files.set(`exports/${A}/r1.json`, '{}');
  setTime(new Date(T0.getTime() + day(EXPORT_LINK_DAYS) - 1000)); assert.equal(await purgeExpiredExports(deps), 0);
  setTime(new Date(T0.getTime() + day(EXPORT_LINK_DAYS) + 1000)); assert.equal(await purgeExpiredExports(deps), 1);
  assert.equal(admin.files.size, 0); assert.equal(r.resultPath, null);
  assert.equal(await purgeExpiredExports(deps), 0);
});
