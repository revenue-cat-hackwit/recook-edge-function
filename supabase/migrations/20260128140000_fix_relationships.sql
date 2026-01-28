-- Fix relationships for PostgREST joins
-- We need explicit FKs to the 'public.profiles' table for PostgREST to detect the relationship in the public schema.
-- Currently they point to 'auth.users' which is hidden from the auto-detected relationships for joins in 'public'.

-- 1. Community Posts -> Profiles
ALTER TABLE community_posts
DROP CONSTRAINT IF EXISTS community_posts_user_id_fkey; -- Remove old ref to auth.users (optional, but cleaner to replace)

ALTER TABLE community_posts
ADD CONSTRAINT community_posts_user_id_fkey
FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- 2. User Recipes -> Profiles
ALTER TABLE user_recipes
DROP CONSTRAINT IF EXISTS user_recipes_user_id_fkey;

ALTER TABLE user_recipes
ADD CONSTRAINT user_recipes_user_id_fkey
FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- 3. Saved Recipes -> Profiles
ALTER TABLE saved_recipes
DROP CONSTRAINT IF EXISTS saved_recipes_user_id_fkey;

ALTER TABLE saved_recipes
ADD CONSTRAINT saved_recipes_user_id_fkey
FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- 4. Subscription -> Profiles (if needed, but usually strictly auth)
-- Let's stick to the content tables for now.

-- 5. Pantry -> Profiles
ALTER TABLE pantry_items
DROP CONSTRAINT IF EXISTS pantry_items_user_id_fkey;

ALTER TABLE pantry_items
ADD CONSTRAINT pantry_items_user_id_fkey
FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- 6. Shopping List -> Profiles
ALTER TABLE shopping_list_items
DROP CONSTRAINT IF EXISTS shopping_list_items_user_id_fkey;

ALTER TABLE shopping_list_items
ADD CONSTRAINT shopping_list_items_user_id_fkey
FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
