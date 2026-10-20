/**
 * GraphQL wire values recovered from the Android 10.1.0 generated Apollo
 * classes in classes5.dex. UNKNOWN__ is a client fallback, never an input.
 * See docs/apk-types-analysis.md for the source classes and limitations.
 */
export const MY_AD_STATUSES = [
  "ACTIVE", "DEACTIVATED", "REFUSED", "DELETED", "PENDING_PAYMENT",
  "PENDING_REVIEW", "BOOSTED_ACTIVE_ADS",
] as const;

export const PERFORMANCE_RANGES = [
  "TODAY", "LAST_7_DAYS", "LAST_15_DAYS", "LAST_30_DAYS", "ALLTIME",
] as const;

export const AD_SORT_PROPERTIES = ["LIST_TIME", "PRICE"] as const;
export const SORT_ORDERS = ["ASC", "DESC"] as const;
export const AD_TYPE_KEYS = [
  "SELL", "BUY", "SWAP", "LET", "RENT", "CO_RENT", "VAC_RENT",
  "sell", "buy", "swap", "let", "rent", "co_rent", "vac_rent",
] as const;
export const SEARCH_ALGORITHMS = ["ORIGINAL", "FUZZY", "KIT10", "KIT10X", "KIT15"] as const;

export const DEACTIVATION_REASONS = [
  "SOLD_ON_SITE", "SOLD_OTHER_MEANS", "EDIT_OR_CHANGE", "RENEW_OR_BUMP", "GIVE_UP", "OTHER",
] as const;
export const SOLD_ON_SITE_DURATIONS = [
  "ONE_DAY", "ONE_WEEK", "ONE_MONTH", "OVER_ONE_MONTH", "DONT_REMEMBER",
] as const;
