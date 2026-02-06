-- Slim down profiles table to act solely as an ID Mapping table
-- Data source of truth is MongoDB, so we remove these columns from Supabase

ALTER TABLE profiles DROP COLUMN IF EXISTS full_name;
ALTER TABLE profiles DROP COLUMN IF EXISTS avatar_url;
ALTER TABLE profiles DROP COLUMN IF EXISTS allergies;
ALTER TABLE profiles DROP COLUMN IF EXISTS diet_goal;
ALTER TABLE profiles DROP COLUMN IF EXISTS equipment;

-- We KEEP:
-- id (UUID) -> Link to Supabase Auth
-- custom_user_id (Text) -> Link to MongoDB
-- email (Text) -> For easy debugging/identification
