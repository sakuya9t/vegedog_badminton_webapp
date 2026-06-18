// ── Supabase database type shim ────────────────────────────────────────────
// A lightweight manual version. For full generated types, run:
//   npx supabase gen types typescript --project-id YOUR_PROJECT_ID > src/lib/database.types.ts
// and replace this file.
export type Database = {
  public: {
    Tables: {
      profiles:        { Row: Profile;        Insert: Partial<Profile>;        Update: Partial<Profile> }
      sessions:        { Row: Session;        Insert: SessionInsert;           Update: Partial<Session> }
      participants:    { Row: Participant;    Insert: ParticipantInsert;       Update: Partial<Participant> }
      payment_methods: { Row: PaymentMethod; Insert: PaymentMethodInsert;     Update: Partial<PaymentMethod> }
      payment_records: { Row: PaymentRecord; Insert: PaymentRecordInsert;     Update: Partial<PaymentRecord> }
      player_ratings:  { Row: PlayerRating;  Insert: Partial<PlayerRating>;    Update: Partial<PlayerRating> }
      rating_history:  { Row: RatingHistory; Insert: Partial<RatingHistory>;   Update: Partial<RatingHistory> }
      notifications:   { Row: Notification;  Insert: Partial<Notification>;    Update: Partial<Notification> }
    }
    Functions: {
      join_session:         { Args: { p_session_id: string; p_user_id: string; p_display_name: string }; Returns: Participant }
      withdraw_participant: { Args: { p_participant_id: string; p_user_id: string }; Returns: Participant }
    }
  }
}

// ── Domain types ───────────────────────────────────────────────────────────

export interface Profile {
  id:             string
  nickname:       string
  avatar_url:     string | null
  venmo_username: string | null
  is_admin:       boolean
  // email notification preferences (all opt-out, default on)
  notify_follow:          boolean
  notify_promoted:        boolean
  notify_match_recorded:  boolean
  notify_match_published: boolean
  created_at:     string
  updated_at:     string
}

export type SessionStatus = 'open' | 'locked' | 'canceled' | 'closed'

export interface Session {
  id:                   string
  title:                string
  location:             string
  location_address:     string | null
  starts_at:            string   // ISO8601 UTC
  withdraw_deadline:    string
  max_participants:     number
  court_count:          number
  fee_per_person:       number | null
  late_withdraw_ratio:  number | null
  notes:                string | null
  status:               SessionStatus
  initiator_id:         string
  created_at:           string
}

export interface SessionWithInitiator extends Session {
  initiator: Pick<Profile, 'id' | 'nickname' | 'avatar_url'>
}

export type ParticipantStatus = 'joined' | 'waitlist' | 'withdrawn' | 'late_withdraw'

export interface Participant {
  id:             string
  session_id:     string
  user_id:        string
  display_name:   string
  queue_position: number
  status:         ParticipantStatus
  stayed_late:    boolean
  joined_at:      string
  withdrew_at:    string | null
}

export interface ParticipantWithProfile extends Participant {
  profile: Pick<Profile, 'id' | 'nickname' | 'avatar_url' | 'venmo_username'>
}

export type PaymentMethodType = 'venmo' | 'zelle' | 'other'

export interface PaymentMethod {
  id:          string
  session_id:  string
  type:        PaymentMethodType
  label:       string
  account_ref: string
  amount:      number | null
  created_by:  string
  created_at:  string
}

export interface SessionAdmin {
  session_id: string
  user_id:    string
  created_at: string
  profile:    Pick<Profile, 'id' | 'nickname' | 'avatar_url'>
}

export type PaymentStatus = 'unpaid' | 'paid' | 'waived'

export interface PaymentRecord {
  id:             string
  session_id:     string
  participant_id: string

  status:         PaymentStatus
  note:           string | null
  updated_at:     string
}

// ── Insert helpers ─────────────────────────────────────────────────────────

export type SessionInsert = Omit<Session, 'id' | 'created_at'>
export type ParticipantInsert = Omit<Participant, 'id' | 'joined_at' | 'withdrew_at'>
export type PaymentMethodInsert = Omit<PaymentMethod, 'id' | 'created_at'>
export type PaymentRecordInsert = Omit<PaymentRecord, 'id' | 'updated_at'>

// ── Restaurant types ────────────────────────────────────────────────────────

export interface Restaurant {
  id:                  string
  name:                string
  cuisine:             string | null
  distance:            string | null
  address:             string | null
  hours:               string | null
  yelp_url:            string | null
  google_maps_url:     string | null
  has_wait:            boolean
  accepts_reservation: boolean
  group_size:          string | null
  added_by:            string | null
  last_updated_by:     string | null
  created_at:          string
}

export interface RestaurantDish {
  id:            string
  restaurant_id: string
  name:          string
  added_by:      string | null
  created_at:    string
}

export interface RestaurantRecommendation {
  id:            string
  restaurant_id: string
  user_id:       string
  recommended:   boolean
  created_at:    string
}

export interface RestaurantTag {
  id:            string
  restaurant_id: string
  name:          string
  added_by:      string | null
  created_at:    string
}

export interface RestaurantWithDetails extends Restaurant {
  adder:           Pick<Profile, 'id' | 'nickname' | 'avatar_url'> | null
  dishes:          RestaurantDish[]
  recommendations: RestaurantRecommendation[]
  tags:            RestaurantTag[]
}

// ── 对战 (Versus / Match) types ───────────────────────────────────────────────

export type MatchType   = 'singles' | 'doubles'
export type MatchStatus = 'draft' | 'pending' | 'published' | 'canceled'

export interface Match {
  id:           string
  type:         MatchType
  recorder_id:  string
  status:       MatchStatus
  is_public:    boolean
  played_at:    string   // ISO8601 UTC
  note:         string | null
  created_at:   string
  published_at: string | null
}

export interface MatchParticipant {
  id:           string
  match_id:     string
  user_id:      string | null   // null for guests (+1)
  is_guest:     boolean
  team:         1 | 2            // 1 = recorder's side
  is_recorder:  boolean
  confirmed:    boolean
  confirmed_at: string | null
  display_name: string
  created_at:   string
}

export interface MatchParticipantWithProfile extends MatchParticipant {
  profile: Pick<Profile, 'id' | 'nickname' | 'avatar_url'> | null
}

export interface MatchGame {
  id:          string
  match_id:    string
  game_no:     number
  team1_score: number
  team2_score: number
  created_at:  string
}

export interface MatchWithDetails extends Match {
  recorder:     Pick<Profile, 'id' | 'nickname' | 'avatar_url'>
  participants: MatchParticipantWithProfile[]
  games:        MatchGame[]
}

// ── 对战积分 (Ratings / 排行榜) types — Phase 2 ──────────────────────────────

export interface PlayerRating {
  user_id:      string
  rating:       number
  games_played: number
  peak_rating:  number
  updated_at:   string
}

export interface PlayerRatingWithProfile extends PlayerRating {
  profile: Pick<Profile, 'id' | 'nickname' | 'avatar_url'> | null
}

export interface RatingHistory {
  id:            string
  match_id:      string
  user_id:       string
  rating_before: number
  rating_after:  number
  delta:         number
  created_at:    string
}

// ── 站内信 (Notifications) — Phase 2 ─────────────────────────────────────────

export type NotificationType =
  | 'follow_session' | 'waitlist_promoted' | 'match_confirm' | 'match_published'

export interface Notification {
  id:         string
  user_id:    string
  type:       NotificationType
  title:      string
  body:       string
  link:       string | null
  read:       boolean
  created_at: string
}

/** A single game's scores, as entered in the score table (before persistence). */
export interface GameInput {
  game_no:     number
  team1_score: number
  team2_score: number
}

/** A participant slot as collected by the create form (before persistence). */
export interface ParticipantInput {
  user_id:      string | null
  is_guest:     boolean
  team:         1 | 2
  is_recorder:  boolean
  display_name: string
}
