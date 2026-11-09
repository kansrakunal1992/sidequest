// Every database function the Circles, safety, notification and game screens call, in one place.
// Each call is written on ONE line as  call<Type>('function_name', { p_arg: value })  so test/db-contract.test.ts can check the function name
// and every argument name against the real migration SQL (a wrong name would otherwise only fail on a phone).
import { supabase } from '@/lib/supabase';
import type { ActiveGameRow, BlockRow, CheckinRow, CircleEvent, CirclePerson, CircleRow, CoupleRow, DataRequestRow, DoubleDateRow, RouletteRow, TeamRow, TrustedContactRow, WingGrantRow, WingSuggestionRow } from '@/core/db-types';

export class DbError extends Error { code: string; constructor(code: string, message: string) { super(message); this.code = code; } }
async function call<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args ?? {});
  if (error) throw new DbError(error.code ?? '', error.message);
  return data as T;
}
const none = (): void => undefined;

export const db = {
  // location (the server rounds again; the phone has already rounded to about 1 km)
  setApproxLocation: (lat: number, lng: number) => call<void>('set_approx_location', { p_lat: lat, p_lng: lng }).then(none),
  // circles
  circlesFeed: (scope: 'browse' | 'mine', category: string | null = null) => call<CircleRow[]>('circles_feed', { p_scope: scope, p_category: category }),
  createCircle: (p: Record<string, unknown>) => call<string>('create_circle', { p }),
  joinCircle: (circle: string) => call<string>('join_circle', { p_circle: circle }),
  leaveCircle: (circle: string) => call<void>('leave_circle', { p_circle: circle }).then(none),
  circlePeople: (circle: string) => call<CirclePerson[]>('circle_people', { p_circle: circle }),
  decideCircleMember: (circle: string, user: string, accept: boolean) => call<void>('decide_circle_member', { p_circle: circle, p_user: user, p_accept: accept }).then(none),
  removeCircleMember: (circle: string, user: string) => call<void>('remove_circle_member', { p_circle: circle, p_user: user }).then(none),
  deleteCircle: (circle: string) => call<void>('delete_circle', { p_circle: circle }).then(none),
  postCircleEvent: (circle: string, p: Record<string, unknown>) => call<string>('post_circle_event', { p_circle: circle, p }),
  circleEvents: (circle: string) => call<CircleEvent[]>('circle_events', { p_circle: circle }),
  joinActivity: (event: string) => call<string>('join_activity', { p_event: event }),
  // roulette
  joinRoulette: (p: Record<string, unknown>) => call<string>('join_roulette', { p }),
  cancelRoulette: (id: string) => call<void>('cancel_roulette', { p_id: id }).then(none),
  myRoulette: () => call<RouletteRow[]>('my_roulette'),
  setRouletteVenue: (group: string, venue: string) => call<void>('set_roulette_venue', { p_group: group, p_venue: venue }).then(none),
  confirmRoulette: (group: string) => call<void>('confirm_roulette', { p_group: group }).then(none),
  // teams and double dates
  myTeams: () => call<TeamRow[]>('my_teams'),
  createTeam: (kind: string, name: string) => call<string>('create_team', { p_kind: kind, p_name: name }),
  inviteToTeam: (team: string, code: string) => call<void>('invite_to_team', { p_team: team, p_code: code }).then(none),
  respondTeamInvite: (team: string, accept: boolean) => call<void>('respond_team_invite', { p_team: team, p_accept: accept }).then(none),
  leaveTeam: (team: string) => call<void>('leave_team', { p_team: team }).then(none),
  postDoubleDate: (team: string, mode: string, starts: string, venue: string | null) => call<string>('post_double_date', { p_team: team, p_mode: mode, p_starts: starts, p_venue: venue }),
  doubleDatesFeed: (mode: string, scope: 'browse' | 'mine') => call<DoubleDateRow[]>('double_dates_feed', { p_mode: mode, p_scope: scope }),
  requestDoubleDate: (dd: string, team: string) => call<void>('request_double_date', { p_dd: dd, p_team: team }).then(none),
  respondDoubleDate: (dd: string, accept: boolean) => call<void>('respond_double_date', { p_dd: dd, p_accept: accept }).then(none),
  cancelDoubleDate: (dd: string) => call<void>('cancel_double_date', { p_dd: dd }).then(none),
  // friend code, wingperson, together
  myFriendCode: () => call<string>('my_friend_code'),
  resetFriendCode: () => call<string>('reset_friend_code'),
  myWingGrants: () => call<WingGrantRow[]>('my_wing_grants'),
  inviteWingperson: (code: string, permissions: string[]) => call<string>('invite_wingperson', { p_code: code, p_permissions: permissions }),
  respondWingInvite: (grant: string, accept: boolean) => call<void>('respond_wing_invite', { p_grant: grant, p_accept: accept }).then(none),
  revokeWing: (grant: string) => call<void>('revoke_wing', { p_grant: grant }).then(none),
  wingOwnerView: (grant: string, mode: string) => call<{ display_name: string; headline: string | null; bio: string | null; prompts: unknown; interests: string[] } | null>('wing_owner_view', { p_grant: grant, p_mode: mode }),
  wingSuggest: (grant: string, kind: string, payload: Record<string, unknown>, note: string | null) => call<string>('wing_suggest', { p_grant: grant, p_kind: kind, p_payload: payload, p_note: note }),
  myWingSuggestions: () => call<WingSuggestionRow[]>('my_wing_suggestions'),
  resolveWingSuggestion: (id: string, accept: boolean) => call<void>('resolve_wing_suggestion', { p_id: id, p_accept: accept }).then(none),
  myCouple: () => call<CoupleRow[]>('my_couple'),
  createCoupleLink: (code: string) => call<string>('create_couple_link', { p_code: code }),
  setCoupleConsent: (couple: string, link: boolean, sharedProfile: boolean, discovery: boolean, paused: boolean | null) => call<void>('set_couple_consent', { p_couple: couple, p_link: link, p_shared_profile: sharedProfile, p_discovery: discovery, p_paused: paused }).then(none),
  unlinkCouple: (id: string) => call<void>('unlink_couple', { p_id: id }).then(none),
  // trusted contacts and check-ins
  myTrustedContacts: () => call<TrustedContactRow[]>('my_trusted_contacts'),
  addTrustedContact: (code: string, label: string) => call<string>('add_trusted_contact', { p_code: code, p_label: label }),
  removeTrustedContact: (id: string) => call<void>('remove_trusted_contact', { p_id: id }).then(none),
  scheduleCheckin: (sourceType: string, sourceId: string, at: string, contact: string) => call<string>('schedule_checkin', { p_source_type: sourceType, p_source_id: sourceId, p_at: at, p_contact: contact }),
  myCheckins: () => call<CheckinRow[]>('my_checkins'),
  confirmCheckin: (id: string, safe: boolean) => call<void>('confirm_checkin', { p_id: id, p_safe: safe }).then(none),
  // account, privacy, data
  pauseAccount: () => call<void>('pause_account').then(none),
  resumeAccount: () => call<void>('resume_account').then(none),
  requestExport: () => call<string>('request_export'),
  requestDeletion: () => call<string>('request_deletion'),
  cancelDeletion: () => call<boolean>('cancel_deletion'),
  myDataRequests: () => call<DataRequestRow[]>('my_data_requests'),
  submitAppeal: (message: string) => call<string>('submit_appeal', { p_message: message }),
  myBlocks: () => call<BlockRow[]>('my_blocks'),
  // trust: plain facts about the other person in a direct chat (needs migration 0015)
  myVerification: () => call<unknown>('my_verification'),
  chatTrust: (conv: string) => call<unknown>('chat_trust', { p_conv: conv }),
  // games
  activeGame: (conv: string) => call<ActiveGameRow[]>('active_game', { p_conv: conv }),
  startGame: (conv: string, kind: string) => call<string>('start_game', { p_conv: conv, p_kind: kind }),
  respondGame: (session: string, accept: boolean) => call<void>('respond_game', { p_session: session, p_accept: accept }).then(none),
  submitAnswer: (session: string, round: number, answer: unknown) => call<void>('submit_answer', { p_session: session, p_round: round, p_answer: answer }).then(none),
};
