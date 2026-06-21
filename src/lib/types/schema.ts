// Core schema types — mirrors the 13-tab Google Sheets structure exactly.
// Field names here MUST match sheet column names later. Do not rename casually.

export type RewardCurrency = "cashback" | "points" | "miles" | "vouchers";
export type CardNetwork = "Visa" | "Mastercard" | "Amex" | "Rupay" | "Diners";
export type CycleFrequency = "monthly" | "quarterly" | "annual" | "custom";
export type CycleAnchor = "calendar" | "anniversary";
export type TierType = "cumulative" | "highest_only";
export type TransactionSource = "manual" | "pdf";
export type ConfidenceFlag = "high" | "low";
export type TermConfidence = "high" | "low";
export type ExclusionScope = "all_rewards" | "milestones_only" | "direct_rewards_only";
// How RewardRule.multiplier_or_rate must be interpreted — see the field comment.
export type RateType = "percentage" | "per_100_spend";

export interface Card {
  id: string;
  card_holder: string;
  card_name: string;
  card_bank: string;
  card_type: CardNetwork;
  card_number_encrypted: string;
  card_number_last4: string;
  expiry_month: number;
  expiry_year: number;
  registered_phone: string;
  registered_email: string;
  annual_fee: number;
  statement_date: number; // day of month
  payment_deadline_days: number;
  customer_care_number: string;
  credit_limit: number;
  renewal_date: string; // ISO date
  issuance_date: string; // ISO date
  benefits_summary: string;
  parent_family: string; // computed: card_bank + card_holder
  current_outstanding_balance: number;
  current_utilization_pct: number;
  manual_override_utilization_pct: number | null;
  active: boolean;
}

export interface RewardRule {
  id: string;
  card_id: string;
  category: string;
  reward_currency: RewardCurrency;
  // How to read `multiplier_or_rate`. These are DIFFERENT reward mechanics, not two
  // notations for one rate:
  //   "percentage"    → the rate is a percent of spend returned directly as
  //                     rupee-equivalent value (e.g. "5% CashPoints" = value worth
  //                     5% of spend). The percent IS the rupee conversion, so the
  //                     direct-reward formula does NOT apply redemption_value_per_unit.
  //   "per_100_spend" → the rate is a COUNT of units (points/miles) earned per Rs 100
  //                     of spend, a different currency until converted — the
  //                     direct-reward formula multiplies by redemption_value_per_unit.
  rate_type: RateType;
  multiplier_or_rate: number;
  // Rupee value of one reward unit. Used by the direct-reward formula ONLY for
  // rate_type "per_100_spend" (a percentage rule needs no unit conversion). Still
  // present on every rule because it may be referenced elsewhere.
  redemption_value_per_unit: number;
  monthly_cap: number | null;
  cap_unit: string | null;
  source_dump_text: string;
  extracted_date: string;
}

export interface Transaction {
  id: string;
  card_id: string;
  date: string;
  merchant: string;
  amount: number;
  category: string;
  notes: string;
  source: TransactionSource;
  statement_file_id: string | null;
  confidence_flag: ConfidenceFlag;
  manual_override_category: string | null;
}

export interface Payment {
  id: string;
  card_id: string;
  date: string;
  amount: number;
  source: string;
}

export interface RecurringTransaction {
  id: string;
  nickname: string;
  card_id: string;
  amount: number;
  category: string;
  billing_day: number;
  start_date: string;
  end_date: string | null; // null = indefinite
  active: boolean;
}

export interface Milestone {
  id: string;
  card_id: string;
  track_name: string;
  cycle_frequency: CycleFrequency;
  cycle_anchor: CycleAnchor;
  anchor_reference_date: string | null;
  tier_type: TierType;
  earning_window_offset: number; // 0 = same cycle, -1 = previous cycle
  cycle_start_date: string;
  cycle_end_date: string;
  active: boolean;
}

export interface MilestoneTier {
  id: string;
  milestone_id: string;
  tier_threshold_amount: number;
  reward_value: number;
  reward_unit: string;
  // Rupee value of one unit of this tier's reward (reward_value is a count in
  // reward_unit). The milestone-contribution math multiplies by this to express
  // the tier reward in rupees. Mirror of RewardRule.redemption_value_per_unit but
  // stored on the tier so the reward's value never has to be inferred.
  redemption_value_per_unit: number;
  is_cumulative_payout: boolean;
  unlocks_in_cycle: "same" | "next";
  current_progress_amount: number;
  achieved: boolean;
  achieved_date: string | null;
  manual_override_achieved: boolean | null;
}

export interface FeeAndCharge {
  id: string;
  card_id: string;
  fee_type: "annual_fee" | "late_payment" | "over_limit" | "forex_markup" | "cash_advance" | "reward_redemption";
  amount_or_rate: number;
  waiver_condition: string;
  source_dump_text: string;
  extracted_date: string;
}

export interface Exclusion {
  id: string;
  card_id: string;
  excluded_category: string;
  applies_to: ExclusionScope;
  notes: string;
  source_dump_text: string;
  extracted_date: string;
}

export interface MonthlySnapshot {
  id: string;
  card_id: string;
  cycle_start_date: string;
  cycle_end_date: string;
  total_spend: number;
  category_breakdown_json: string;
  predicted_next_bill: number;
  anomaly_flags_json: string;
  manual_override_predicted_bill: number | null;
}

export interface FamilyCapTracker {
  family_key: string;
  financial_year: string; // e.g. "2026-27"
  total_paid: number;
  cap_amount: number;
  remaining: number;
  manual_override_total_paid: number | null;
}

export interface CardTermsHistoryEntry {
  id: string;
  card_id: string;
  field_changed: string;
  old_value: string;
  new_value: string;
  confidence: TermConfidence;
  source_url: string;
  detected_date: string;
  confirmed: boolean;
  notes: string;
}

export interface Category {
  name: string;
}

export interface Database {
  cards: Card[];
  rewardRules: RewardRule[];
  transactions: Transaction[];
  payments: Payment[];
  recurringTransactions: RecurringTransaction[];
  milestones: Milestone[];
  milestoneTiers: MilestoneTier[];
  feesAndCharges: FeeAndCharge[];
  exclusions: Exclusion[];
  monthlySnapshots: MonthlySnapshot[];
  familyCapTracker: FamilyCapTracker[];
  cardTermsHistory: CardTermsHistoryEntry[];
  categories: Category[];
}
