-- Clean up orphans before adding constraints
DELETE FROM public.post_comments
WHERE user_id NOT IN (SELECT id FROM public.profiles);

DELETE FROM public.community_posts
WHERE user_id NOT IN (SELECT id FROM public.profiles);

-- Fix User ID Foreign Key to point to Profiles (for PostgREST joins)
ALTER TABLE public.post_comments
DROP CONSTRAINT IF EXISTS post_comments_user_id_fkey;

ALTER TABLE public.post_comments
ADD CONSTRAINT post_comments_user_id_fkey
FOREIGN KEY (user_id)
REFERENCES public.profiles(id)
ON DELETE CASCADE;

-- Do the same for community_posts
ALTER TABLE public.community_posts
DROP CONSTRAINT IF EXISTS community_posts_user_id_fkey;

ALTER TABLE public.community_posts
ADD CONSTRAINT community_posts_user_id_fkey
FOREIGN KEY (user_id)
REFERENCES public.profiles(id)
ON DELETE CASCADE;
