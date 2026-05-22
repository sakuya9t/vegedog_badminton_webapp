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
