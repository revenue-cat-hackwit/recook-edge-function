-- Add session_id to chat_messages to support multiple chat sessions
ALTER TABLE chat_messages 
ADD COLUMN session_id UUID;

-- Optional: Index for performance
CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON chat_messages(session_id);

-- Create a view or function to get chat sessions summary if needed, 
-- but we can also just query Distinct session_ids with their last message using distinct on.
