-- Comments Table
CREATE TABLE IF NOT EXISTS public.post_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID REFERENCES public.community_posts(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.post_comments ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Comments are viewable by everyone" 
ON public.post_comments FOR SELECT 
USING (true);

CREATE POLICY "Users can create comments" 
ON public.post_comments FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own comments"
ON public.post_comments FOR DELETE
USING (auth.uid() = user_id);

-- RPC for increment/decrement likes (if not exists)
CREATE OR REPLACE FUNCTION increment_likes(row_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE community_posts
  SET likes_count = likes_count + 1
  WHERE id = row_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION decrement_likes(row_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE community_posts
  SET likes_count = GREATEST(likes_count - 1, 0)
  WHERE id = row_id;
END;
$$ LANGUAGE plpgsql;
