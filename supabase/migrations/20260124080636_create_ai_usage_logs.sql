CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- AI Usage Logs Table
CREATE TABLE IF NOT EXISTS ai_usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  model TEXT NOT NULL,
  task_type TEXT DEFAULT 'chat', -- 'chat', 'image_analysis', etc.
  prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  has_subscription BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for AI usage logs
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_user_id ON ai_usage_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_created_at ON ai_usage_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_model ON ai_usage_logs(model);

-- Enable RLS
ALTER TABLE ai_usage_logs ENABLE ROW LEVEL SECURITY;

-- AI Usage Logs Policies
-- Users can view their own AI usage
CREATE POLICY "Users can view own AI usage"
  ON ai_usage_logs
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Only service role can insert AI usage logs
CREATE POLICY "Service role can manage AI usage logs"
  ON ai_usage_logs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
