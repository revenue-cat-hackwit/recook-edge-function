-- Drop tables as requested by user
-- Using CASCADE to ensure dependent objects (FKs, policies, indexes) are also removed

DROP TABLE IF EXISTS "post_likes" CASCADE;
DROP TABLE IF EXISTS "post_comments" CASCADE; -- Assumed from 'post comments'
DROP TABLE IF EXISTS "reference_allergies" CASCADE;
DROP TABLE IF EXISTS "reference_equipment" CASCADE;
DROP TABLE IF EXISTS "reference_cuisines" CASCADE;
DROP TABLE IF EXISTS "reference_taste_preferences" CASCADE;
DROP TABLE IF EXISTS "community_posts" CASCADE;
DROP TABLE IF EXISTS "user_subscriptions" CASCADE;
