/** Row shapes returned by the database functions the Circles, safety and games screens call (names follow the SQL, in snake_case). */
export interface CircleRow { id: string; name: string; description: string | null; visibility: 'public' | 'request_to_join' | 'private'; category: string | null; member_count: number; my_role: string | null; my_status: string | null; owner_name: string | null; conversation_id: string | null }
export interface CirclePerson { user_id: string; display_name: string; role: string; status: string }
export interface CircleEvent { id: string; title: string; description: string | null; starts_at: string; area_label: string; public_venue_name: string | null; capacity: number | null; going: number; my_status: string | null; is_mine: boolean; status: string }
export interface RouletteRow { signup_id: string; mode_id: string; activity: string; slot_start: string; group_size: number; area_label: string; status: string; group_id: string | null; venue: string | null; conversation_id: string | null; is_host: boolean | null; members: string[] | null }
export interface DoubleDateRow { id: string; state: string; starts_at: string; venue: string | null; team_a_names: string[]; team_b_names: string[] | null; team_a_kind: string; is_mine: boolean; my_team: string | null; can_request: boolean }
export interface TeamMember { user_id: string; name: string; status: string }
export interface TeamRow { team_id: string; kind: string; name: string | null; is_creator: boolean; my_status: string; members: TeamMember[] }
export interface WingGrantRow { grant_id: string; role: 'owner' | 'wing'; other_id: string; other_name: string; permissions: string[]; status: string; expires_at: string | null }
export interface WingSuggestionRow { id: string; grant_id: string; from_name: string; kind: string; payload: Record<string, unknown>; note: string | null; created_at: string }
export interface CoupleRow { couple_id: string; partner_id: string; partner_name: string; i_am_a: boolean; a_link: boolean; a_shared_profile: boolean; a_discovery: boolean; b_link: boolean; b_shared_profile: boolean; b_discovery: boolean; paused: boolean }
export interface TrustedContactRow { id: string; label: string; contact_name: string | null; direction: 'mine' | 'for_me' }
export interface CheckinRow { id: string; source_type: string; source_id: string; check_in_at: string; status: string; contact_label: string | null }
export interface DataRequestRow { id: string; kind: 'export' | 'deletion'; status: string; requested_at: string; completed_at: string | null; ready: boolean }
export interface BlockRow { user_id: string; display_name: string | null; blocked_at: string }
export interface NotificationRow { id: string; kind: string; payload: Record<string, unknown> | null; read_at: string | null; created_at: string }
export interface GameSessionRow { id: string; kind: string; state: string; created_by: string; conversation_id: string }
export interface GamePlayerRow { user_id: string; accepted: boolean }
export interface GameResponseRow { user_id: string; round: number; answer: unknown }
export interface ActiveGameRow { session_id: string; kind: string; state: string; created_by: string }
