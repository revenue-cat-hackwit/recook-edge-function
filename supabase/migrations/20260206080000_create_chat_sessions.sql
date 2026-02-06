-- 1. Create chat_sessions table to verify standard session management
CREATE TABLE IF NOT EXISTS public.chat_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    title TEXT DEFAULT 'New Chat',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Enable RLS
ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Manage own sessions" ON public.chat_sessions
    FOR ALL TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- 3. Add FK constraint to chat_messages (optional but good for integrity)
-- Note: existing messages might have random UUIDs that don't exist in sessions yet.
-- We will handle migration gracefully or leave it loose for now.

-- 4. Update the optimized function to use the REAL sessions table
CREATE OR REPLACE FUNCTION get_user_chat_sessions()
RETURNS TABLE (
    id UUID,
    title TEXT,
    last_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE,
    message_count BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        cs.id,
        cs.title,
        COALESCE(
            (SELECT 
                CASE 
                    WHEN jsonb_typeof(cm.content) = 'string' THEN cm.content#>>'{}'
                    WHEN jsonb_typeof(cm.content) = 'array' THEN 'Image/Media Content'
                    ELSE '...'
                END
             FROM chat_messages cm 
             WHERE cm.session_id = cs.id 
             ORDER BY cm.created_at DESC 
             LIMIT 1), 
            'No messages'
        ) as last_message,
        cs.updated_at as created_at, -- Use updated_at for sorting by recent activity
        (SELECT COUNT(*) FROM chat_messages cm WHERE cm.session_id = cs.id) as message_count
    FROM chat_sessions cs
    WHERE cs.user_id = auth.uid()
    ORDER BY cs.updated_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
