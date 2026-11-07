import * as pg from 'pg';
import { loadConfig } from './config.ts';
import { escalateCheckins, expireInvites, expireOpenCalls, liftSuspensions, processDeletions, processExports, promptCheckins, purgeExpiredExports, runRoulette, sendReminders } from './jobs.ts';
import { NoopPushSender, createNotifier } from './notifications.ts';
import type { PushSender } from './notifications.ts';
import { PgStore } from './pg-store.ts';
import { FcmSender } from './push-fcm.ts';
import { SupabaseAdminClient } from './supabase-admin.ts';

const cfg = loadConfig(process.env, 'worker');
const log = (m: string) => console.log(JSON.stringify({ t: new Date().toISOString(), m }));
const pool = new pg.Pool({ connectionString: cfg.databaseUrl, max: 3, ssl: cfg.pgSsl ? { rejectUnauthorized: false } : false });
const store = new PgStore(pool);
const clock = () => new Date();
const sender: PushSender = cfg.fcmServiceAccountJson ? new FcmSender(JSON.parse(cfg.fcmServiceAccountJson)) : new NoopPushSender();
const deps = { store, notifier: createNotifier({ store, sender, clock, log }), clock, log };
const dataDeps = { ...deps, admin: new SupabaseAdminClient(cfg.supabaseUrl, cfg.serviceRoleKey!) };   // loadConfig guarantees the key for the worker

/** Only log runs that did something, so a quiet minute stays quiet. */
const didSomething = (r: unknown): boolean => typeof r === 'number' ? r > 0 : typeof r === 'object' && r !== null && Object.values(r).some((v) => typeof v === 'number' && v > 0);

/** Runs a job on an interval; a slow run never overlaps itself and a failure never kills the worker. */
function every(name: string, ms: number, fn: () => Promise<unknown>) {
  let running = false;
  const tick = async () => {
    if (running) return; running = true;
    try { const r = await fn(); if (didSomething(r)) log(`${name}: ${JSON.stringify(r)}`); } catch (e) { log(`${name} failed: ${(e as Error).message}`); }
    finally { running = false; }
  };
  void tick(); return setInterval(tick, ms);
}
const timers = [
  every('expire_invites', 60_000, () => expireInvites(deps)),
  every('reminders', 60_000, () => sendReminders(deps)),
  every('expire_open_calls', 60_000, () => expireOpenCalls(deps)),
  every('roulette', 5 * 60_000, () => runRoulette(deps)),
  every('checkin_prompts', 60_000, () => promptCheckins(deps)),
  every('checkin_escalation', 60_000, () => escalateCheckins(deps)),
  every('lift_suspensions', 10 * 60_000, () => liftSuspensions(deps)),
  every('data_exports', 60_000, () => processExports(dataDeps)),
  every('account_deletions', 10 * 60_000, () => processDeletions(dataDeps)),
  every('purge_exports', 60 * 60_000, () => purgeExpiredExports(dataDeps)),
];
log('worker started');
const stop = () => { timers.forEach(clearInterval); pool.end().finally(() => process.exit(0)); setTimeout(() => process.exit(1), 10_000).unref(); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
