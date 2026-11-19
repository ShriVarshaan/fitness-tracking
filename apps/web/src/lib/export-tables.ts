// Everything stored for the signed-in user, as one JSON file.
// Reads go through the user's own session, so RLS returns only their rows.
export const EXPORT_TABLES = [
  "profile",
  "user_physiology",
  "garmin_connection",
  "daily_summaries",
  "sleep_sessions",
  "hrv_daily",
  "vo2max_daily",
  "activities",
  "activity_laps",
  "activity_sets",
  "activity_streams",
  "derived_daily",
  "findings",
  "insights",
  "chat_messages",
  "push_subscriptions",
  "sync_jobs",
  "raw_ingest",
] as const;
