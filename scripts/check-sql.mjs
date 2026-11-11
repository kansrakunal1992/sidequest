// Static checks on the SQL migrations. Not a substitute for running them against Postgres,
// but catches the mistakes that matter most: forgotten RLS, forward references, risky policies.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = new URL('../supabase/migrations/', import.meta.url).pathname;
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const sql = files.map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
const strip = sql.replace(/--.*$/gm, '');
const errors = [];

const tables = new Map();
for (const m of strip.matchAll(/create table public\.(\w+)/g)) tables.set(m[1], m.index);

// 1. forward references
for (const m of strip.matchAll(/references public\.(\w+)/g)) {
  const t = tables.get(m[1]);
  if (t === undefined) errors.push(`references unknown table public.${m[1]}`);
  else if (t > m.index) errors.push(`forward reference to public.${m[1]} before it is created`);
}
// 2. enums used before defined
const enums = new Set([...strip.matchAll(/create type (\w+) as enum/g)].map((m) => m[1]));
for (const e of enums) {
  const def = strip.search(new RegExp(`create type ${e} as enum`));
  const use = strip.search(new RegExp(`\\b${e}\\b(?! as enum)`));
  if (use !== -1 && use < def) errors.push(`enum ${e} used before definition`);
}
// 3. RLS enabled for all tables (blanket DO block) and each table has at least one policy
if (!/for t in select tablename from pg_tables where schemaname = 'public'[\s\S]*enable row level security/.test(strip)) {
  errors.push('blanket "enable row level security" block is missing');
}
const dropped = new Set([...strip.matchAll(/drop policy (\w+) on/g)].map((m) => m[1]));
const policies = [...strip.matchAll(/create policy (\w+) on ([\w.]+)\s+for (\w+) to (\w+)([\s\S]*?);/g)].filter((m) => !dropped.has(m[1]) || strip.lastIndexOf(`create policy ${m[1]} on`) > strip.lastIndexOf(`drop policy ${m[1]} on`));
const policyCount = new Map();
for (const [, , tbl] of policies) policyCount.set(tbl.replace('public.', ''), (policyCount.get(tbl.replace('public.', '')) ?? 0) + 1);
const SERVICE_ONLY = new Set(['friend_code_lookups', 'banned_identifiers', 'moderator_audit', 'mode_features', 'photo_verifications', 'data_requests', 'trusted_contacts', 'meeting_checkins']);   // no client access by design; functions only
for (const t of tables.keys()) if (!policyCount.get(t) && !SERVICE_ONLY.has(t)) errors.push(`table public.${t} has no policy (clients locked out); add one or whitelist it`);
// 3b. tables created after the blanket 0003 block must enable RLS themselves
{
  const firstLate = files.findIndex((f) => f >= '0004');
  const lateSql = files.slice(firstLate).map((f) => readFileSync(join(dir, f), 'utf8').replace(/--.*$/gm, '')).join('\n');
  for (const m of lateSql.matchAll(/create table public\.(\w+)/g)) {
    if (!new RegExp(`alter table public\\.${m[1]} enable row level security`).test(lateSql)) errors.push(`table public.${m[1]} was created after 0003 and never enables row level security`);
  }
}
// 4. policy hygiene
for (const [full, name, tbl, cmd, role, body] of policies) {
  if (role !== 'authenticated') errors.push(`policy ${name} is not restricted to authenticated`);
  if (/using \(true\)/.test(body) && !['intent_modes_read'].includes(name)) errors.push(`policy ${name} is wide open`);
  if (cmd === 'all' && !/with check/.test(body)) errors.push(`policy ${name} (for all) lacks WITH CHECK`);
  if (cmd === 'insert' && !/with check/.test(body)) errors.push(`insert policy ${name} lacks WITH CHECK`);
}
// 5. invariants that must never regress
for (const [, name, tbl, , , body] of policies) {
  if (/wing/i.test(name + body) && /messages|conversation/.test(tbl)) errors.push(`wingperson must never touch ${tbl} (${name})`);
}
for (const t of ['messages', 'conversations', 'conversation_members']) {
  if (policies.some(([, , tbl, , , body]) => tbl.endsWith(t) && /wingperson|wing_can/.test(body))) errors.push(`wingperson reference in ${t} policies`);
}
if (policies.some(([, , tbl, cmd]) => tbl.endsWith('post_meet_feedback') && cmd === 'select' && /about_user/.test(strip.slice(strip.indexOf('post_meet_select'), strip.indexOf('post_meet_select') + 300)))) {
  errors.push('post_meet_feedback must not be readable by about_user');
}
const NO_INSERT = ['conversation_invites', 'calendar_entries', 'matches', 'notifications', 'open_calls', 'open_call_participants', 'events', 'event_participants',
  'wingperson_grants', 'wing_suggestions', 'teams', 'team_members', 'double_dates', 'roulette_signups', 'circles', 'circle_members', 'chemistry_sessions', 'chemistry_players', 'chemistry_responses', 'couple_links', 'appeals',
  'data_requests', 'trusted_contacts', 'meeting_checkins', 'photo_verifications', 'date_ideas'];
const NO_MODIFY = ['open_calls', 'open_call_participants', 'events', 'event_participants', 'wingperson_grants', 'wing_suggestions', 'teams', 'team_members', 'double_dates', 'roulette_signups',
  'circles', 'circle_members', 'chemistry_sessions', 'chemistry_players', 'chemistry_responses',
  'data_requests', 'trusted_contacts', 'meeting_checkins', 'photo_verifications', 'date_ideas'];
for (const t of NO_INSERT) {
  for (const [, name, tbl, cmd] of policies) {
    if (tbl.endsWith(t) && cmd === 'insert') errors.push(`clients must not insert into ${t} (${name}); the API/trigger owns it`);
    if (NO_MODIFY.includes(t) && tbl.endsWith(t) && (cmd === 'update' || cmd === 'delete' || cmd === 'all')) errors.push(`clients must not modify ${t} directly (${name}); use the checked functions`);
  }
}
// 6. every security definer function pins search_path
for (const m of strip.matchAll(/create or replace function ([\w.]+)\([^)]*\)[\s\S]*?(?=\n(?:create |revoke |grant |insert |do \$\$|-- =====)|$)/g)) {
  if (/security definer/.test(m[0]) && !/set search_path/.test(m[0])) errors.push(`function ${m[1]} is security definer without search_path`);
}

// 7. column-level hardening: every table with a client update policy needs `grant update (cols)` unless full-row update is safe
const FULL_UPDATE_OK = new Set([
  'user_active_modes', 'mode_specific_profiles', 'preferences', 'saved_collections', 'saves', 'passes',
  'connection_stages', 'push_tokens', 'notification_preferences', 'blocks',
  'wingperson_grants',   // guarded by trigger wing_grant_guard (owner vs wing)
  'couple_links',        // guarded by trigger couple_consent_guard
  'couple_profiles', 'circle_members', // circle_members guarded by circle_role_guard
  'date_plan_votes',
]);
const colGrants = new Set([...strip.matchAll(/grant update \([^)]*\)\s+on\s+public\.(\w+)/g)].map((m) => m[1]));
for (const [, name, tbl, cmd] of policies) {
  const t = tbl.replace('public.', '');
  if ((cmd === 'update' || cmd === 'all') && !t.startsWith('storage') && !FULL_UPDATE_OK.has(t) && !colGrants.has(t)) {
    errors.push(`policy ${name}: table ${t} is client-updatable but has no column-level "grant update (...)"`);
  }
}
for (const t of ['profiles']) if (!/revoke update on public\.profiles from authenticated/.test(strip) || !colGrants.has(t)) errors.push('profiles must have column-level update grants');
if (!/revoke insert on public\.profiles from authenticated/.test(strip)) errors.push('clients must not insert into profiles directly');

console.log(`files: ${files.join(', ')}`);
console.log(`tables: ${tables.size}, policies: ${policies.length}, enums: ${enums.size}`);
if (errors.length) { console.error('\nFAILED:\n- ' + errors.join('\n- ')); process.exit(1); }
console.log('SQL static checks passed');
