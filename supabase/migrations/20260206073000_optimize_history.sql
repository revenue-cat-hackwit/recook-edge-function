-- Function to efficiently get chat sessions summary
-- Combines grouping, counting, and extracting first/last messages in SQL

CREATE OR REPLACE FUNCTION get_user_chat_sessions()
RETURNS TABLE (
    id UUID,             -- This acts as the session_id
    title TEXT,
    last_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE, -- Returns the LAST updated time for sorting
    message_count BIGINT
) AS $$
BEGIN
    RETURN QUERY
    WITH session_groups AS (
        -- Group by Session ID to get counts and max date
        SELECT 
            cm.session_id,
            MAX(cm.created_at) as last_interaction,
            MIN(cm.created_at) as first_interaction,
            COUNT(*) as msg_count
        FROM chat_messages cm
        WHERE cm.user_id = auth.uid() 
          AND cm.session_id IS NOT NULL
        GROUP BY cm.session_id
    ),
    first_msgs AS (
        -- Get the VERY FIRST message content to use as title
        SELECT DISTINCT ON (cm.session_id) cm.session_id, cm.content
        FROM chat_messages cm
        WHERE cm.user_id = auth.uid()
        ORDER BY cm.session_id, cm.created_at ASC
    ),
    last_msgs AS (
        -- Get the VERY LAST message content to use as preview
        SELECT DISTINCT ON (cm.session_id) cm.session_id, cm.content
        FROM chat_messages cm
        WHERE cm.user_id = auth.uid()
        ORDER BY cm.session_id, cm.created_at DESC
    )
    SELECT 
        sg.session_id as id,
        -- Extract title from first message (handle JSON or String)
        CASE 
            WHEN jsonb_typeof(fm.content) = 'string' THEN fm.content#>>'{}'
            WHEN jsonb_typeof(fm.content) = 'array' THEN 
                COALESCE(fm.content->0->>'text', 'Image/Media Content')
            ELSE 'New Chat'
        END as title,
        
        -- Extract preview from last message
        CASE 
             WHEN jsonb_typeof(lm.content) = 'string' THEN lm.content#>>'{}'
             WHEN jsonb_typeof(lm.content) = 'array' THEN 'Image/Media Content'
             ELSE '...'
        END as last_message,
        
        sg.last_interaction as created_at,
        sg.msg_count as message_count
    FROM session_groups sg
    LEFT JOIN first_msgs fm ON sg.session_id = fm.session_id
    LEFT JOIN last_msgs lm ON sg.session_id = lm.session_id
    ORDER BY sg.last_interaction DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
