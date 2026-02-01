-- Add missing RLS policies for chat_messages table
-- This allows users to manage their own chat history

-- Policy for users to view their own chat messages
CREATE POLICY "Users can view own chat messages" ON chat_messages
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Policy for users to insert their own chat messages
CREATE POLICY "Users can insert own chat messages" ON chat_messages
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Policy for users to delete their own chat messages
CREATE POLICY "Users can delete own chat messages" ON chat_messages
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- Add index for better query performance
CREATE INDEX IF NOT EXISTS idx_chat_messages_user_id ON chat_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at DESC);
