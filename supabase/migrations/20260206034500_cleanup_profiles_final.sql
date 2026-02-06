-- Clean up remaining columns in profiles table
-- Based on user screenshot, dropping: username, bio, taste_preferences, cuisines

ALTER TABLE profiles DROP COLUMN IF EXISTS username;
ALTER TABLE profiles DROP COLUMN IF EXISTS bio;
ALTER TABLE profiles DROP COLUMN IF EXISTS taste_preferences;
ALTER TABLE profiles DROP COLUMN IF EXISTS cuisines;

-- Note: We keep 'email' for now as a handy reference, but data flow relies on custom_user_id.
