/** Every kind of notification. The API must have push copy for each, and the app must have inbox copy for each (both enforced by tests/types). */
export const NOTIFICATION_KINDS = [
  'invite_received', 'invite_accepted', 'invite_declined', 'invite_too_new', 'invite_reschedule_requested', 'invite_rescheduled', 'invite_cancelled', 'invite_expired',
  'invite_reminder', 'invite_day_before', 'light_chat_started', 'post_meet_prompt', 'roulette_group_ready', 'open_call_expired', 'message_received',
  'open_call_interest', 'open_call_accepted', 'open_call_update', 'activity_update',
  'wing_invited', 'wing_suggestion', 'team_invited', 'double_date_request', 'double_date_update', 'roulette_update', 'game_invite', 'circle_request',
  'couple_invited', 'trusted_added', 'checkin_prompt', 'checkin_missed', 'checkin_help', 'checkin_safe', 'moderation_notice', 'export_ready', 'verification_result',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];
