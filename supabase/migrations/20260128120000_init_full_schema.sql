-- Database Schema for Pirinku Backend
-- Run this in your Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==========================================
-- 1. CORE USER DATA
-- ==========================================

-- User Profiles (Extended)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  avatar_url TEXT,
  
  -- Preferences (New)
  allergies TEXT[],
  diet_goal TEXT,
  equipment TEXT[],
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Ensure columns exist (in case table already existed without them)
DO $$
BEGIN
    ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email TEXT;
    ALTER TABLE profiles ADD COLUMN IF NOT EXISTS full_name TEXT;
    ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;
    ALTER TABLE profiles ADD COLUMN IF NOT EXISTS allergies TEXT[];
    ALTER TABLE profiles ADD COLUMN IF NOT EXISTS diet_goal TEXT;
    ALTER TABLE profiles ADD COLUMN IF NOT EXISTS equipment TEXT[];
EXCEPTION
    WHEN duplicate_column THEN RAISE NOTICE 'column already exists';
END $$;

-- User Subscriptions (RevenueCat)
CREATE TABLE IF NOT EXISTS user_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  product_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'expired', 'billing_issue', 'cancelled')),
  purchased_at TIMESTAMP WITH TIME ZONE NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE,
  platform TEXT CHECK (platform IN ('ios', 'android')),
  store TEXT CHECK (store IN ('APP_STORE', 'PLAY_STORE')),
  environment TEXT CHECK (environment IN ('PRODUCTION', 'SANDBOX')),
  verified_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- 2. RECIPES & CONTENT
-- ==========================================

-- User Generated Recipes
CREATE TABLE IF NOT EXISTS user_recipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  ingredients JSONB NOT NULL, -- ["Item 1", "Item 2"]
  steps JSONB NOT NULL,       -- [{step: 1, instruction: "..."}]
  time_minutes TEXT,
  difficulty TEXT,
  servings TEXT,
  calories_per_serving TEXT,
  tips TEXT,
  source_url TEXT,
  image_url TEXT,
  
  -- Community Status
  is_public BOOLEAN DEFAULT false,
  published_at TIMESTAMP WITH TIME ZONE,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Saved Recipes (Favorites/Bookmarks)
CREATE TABLE IF NOT EXISTS saved_recipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  recipe_id UUID REFERENCES user_recipes(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, recipe_id) -- Prevent duplicate saves
);

-- Community Posts (The Feed)
-- Note: We can either query user_recipes where is_public=true OR use a separate table.
-- A separate table allows "snapshots" so editing the private recipe doesn't break the public post.
CREATE TABLE IF NOT EXISTS community_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  original_recipe_id UUID REFERENCES user_recipes(id) ON DELETE SET NULL,
  
  -- Snapshot Data
  title TEXT NOT NULL,
  image_url TEXT,
  recipe_snapshot JSONB NOT NULL, -- Full recipe data at time of posting
  
  likes_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Post Likes
CREATE TABLE IF NOT EXISTS post_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  post_id UUID REFERENCES community_posts(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, post_id)
);

-- ==========================================
-- 3. UTILITIES (Shopping & Chat)
-- ==========================================

-- Shopping List
CREATE TABLE IF NOT EXISTS shopping_list_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  is_checked BOOLEAN DEFAULT false,
  from_recipe_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Chat History
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content JSONB NOT NULL, -- Text or Structured Content
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);


-- Pantry Items (The Fridge)
CREATE TABLE IF NOT EXISTS pantry_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  ingredient_name TEXT NOT NULL,
  quantity TEXT,
  expiry_date DATE,
  category TEXT, -- 'Dairy', 'Vegetable', etc.
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Usage Logs
CREATE TABLE IF NOT EXISTS ai_usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  model TEXT NOT NULL,
  task_type TEXT DEFAULT 'chat',
  prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  has_subscription BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Webhook Logs
CREATE TABLE IF NOT EXISTS webhook_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  processed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  success BOOLEAN DEFAULT true,
  error_message TEXT
);


-- 12. Pantry Categories (Data-driven categorization)
CREATE TABLE IF NOT EXISTS public.pantry_categories (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  keywords TEXT[] NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.pantry_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Pantry Categories are viewable by everyone" ON public.pantry_categories
  FOR SELECT USING (true);


-- 13. Reference Data (Allergies & Equipment)
-- (Existing reference tables follow below)


-- ==========================================
-- 4. INDEXES
-- ==========================================

CREATE INDEX IF NOT EXISTS idx_user_recipes_user_id ON user_recipes(user_id);
CREATE INDEX IF NOT EXISTS idx_user_recipes_is_public ON user_recipes(is_public);
CREATE INDEX IF NOT EXISTS idx_community_posts_created_at ON community_posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pantry_items_user_id ON pantry_items(user_id);
CREATE INDEX IF NOT EXISTS idx_pantry_items_expiry ON pantry_items(expiry_date);
CREATE INDEX IF NOT EXISTS idx_shopping_list_user_id ON shopping_list_items(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_recipes_user_id ON saved_recipes(user_id);

-- ==========================================
-- 5. RLS POLICIES
-- ==========================================

ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE shopping_list_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE pantry_items ENABLE ROW LEVEL SECURITY;

-- ... (Existing Policies for Subscriptions/Profiles/Recipes kept conceptually) ...

-- Pantry Items: Users Only Own
CREATE POLICY "Manage own pantry" ON pantry_items
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Shopping List: Users Only Own
CREATE POLICY "Manage own shopping list" ON shopping_list_items
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Community Posts: Public Read, User Write
CREATE POLICY "View public posts" ON community_posts
  FOR SELECT TO authenticated USING (true);

-- 13. Reference Data (Allergies & Equipment)
CREATE TABLE IF NOT EXISTS public.reference_allergies (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);
CREATE POLICY "Ref Allergies are viewable by everyone" ON public.reference_allergies FOR SELECT USING (true);


CREATE TABLE IF NOT EXISTS public.reference_equipment (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);
CREATE POLICY "Ref Equipment are viewable by everyone" ON public.reference_equipment FOR SELECT USING (true);

CREATE POLICY "Create posts" ON community_posts
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- Saved Recipes: Users Only Own
CREATE POLICY "Manage saved recipes" ON saved_recipes
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- ==========================================
-- 6. TRIGGERS & FUNCTIONS
-- ==========================================

-- Trigger to handle new user profile creation
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Trigger for Updated At
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- View for Active Subscriptions
CREATE OR REPLACE VIEW active_subscriptions AS
SELECT 
  us.*,
  p.email,
  p.full_name
FROM user_subscriptions us
JOIN profiles p ON us.user_id = p.id
WHERE 
  us.status = 'active' 
  AND (us.expires_at IS NULL OR us.expires_at > NOW());

GRANT SELECT ON active_subscriptions TO authenticated;
GRANT SELECT ON active_subscriptions TO service_role;

-- ==========================================
-- 7. RPC FUNCTIONS (Likes)
-- ==========================================

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
  SET likes_count = GREATEST(0, likes_count - 1)
  WHERE id = row_id;
END;
$$ LANGUAGE plpgsql;
