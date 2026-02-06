-- TRUNCATE ALL DATA from Cloud Database
-- This is a destructive operation to reset the database state.
-- We use CASCADE to handle foreign key dependencies.

TRUNCATE TABLE 
  "user_recipes",
  "saved_recipes",
  "meal_plans",
  "pantry_items",
  "pantry_categories",
  "shopping_list_items",
  "ai_usage_logs",
  "webhook_logs",
  "profiles"
CASCADE;

-- Note: auth.users (System Table) is NOT truncated because it requires superuser access and is managed by Supabase.
-- Users will just re-upsert their profile upon next login properly via UserSync.
