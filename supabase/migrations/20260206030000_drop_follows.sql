-- Drop table follows as requested
DROP TABLE IF EXISTS "follows" CASCADE;

-- Note on profiles:
-- The 'profiles' table is currently CRITICAL for the Custom JWT Auth flow 
-- because it maps the 'custom_user_id' (MongoDB) to the Supabase 'id' (UUID).
-- Deleting 'profiles' would break:
-- 1. The UserSyncService (which writes to this table)
-- 2. The Edge Function (which reads from this table)
-- 
-- If you strictly want to drop 'profiles' and break this link, 
-- uncomment the line below. Otherwise, it is preserved for system stability.
-- DROP TABLE IF EXISTS "profiles" CASCADE;
