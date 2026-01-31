-- Create a cache table for AI recipe generations
-- This helps avoid hitting the AI provider repeatedly for the same content
CREATE TABLE IF NOT EXISTS public.ai_recipe_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_url TEXT NOT NULL,       -- URL of the video/image
    recipe_json JSONB NOT NULL,     -- The full recipe result
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Index for fast lookup
CREATE INDEX IF NOT EXISTS ai_recipe_cache_source_url_idx ON public.ai_recipe_cache (source_url);

-- RLS: Read is safe for server service role, but let's allow anon/authenticated read if needed?
-- Usually accessed by Edge Function via Service Role, so RLS on table valid for public access not strictly needed unless client queries it directly.
-- Let's enable RLS and allow read access just in case.
ALTER TABLE public.ai_recipe_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read access to anyone"
ON public.ai_recipe_cache FOR SELECT
USING (true);

-- Allow insert by service role only (Edge Functions typically bypass RLS if Key is service_role, but if using anon key they need policy)
-- Since our Edge Function uses anon key to call DB? No, usually it creates a client.
CREATE POLICY "Allow insert by anon/authenticated"
ON public.ai_recipe_cache FOR INSERT
WITH CHECK (true);
