-- Add custom_user_id to all tables
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS custom_user_id TEXT UNIQUE;
ALTER TABLE user_recipes ADD COLUMN IF NOT EXISTS custom_user_id TEXT;
ALTER TABLE meal_plans ADD COLUMN IF NOT EXISTS custom_user_id TEXT;
ALTER TABLE pantry_items ADD COLUMN IF NOT EXISTS custom_user_id TEXT;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_profiles_custom_user_id ON profiles(custom_user_id);
CREATE INDEX IF NOT EXISTS idx_user_recipes_custom_user_id ON user_recipes(custom_user_id);
CREATE INDEX IF NOT EXISTS idx_meal_plans_custom_user_id ON meal_plans(custom_user_id);
CREATE INDEX IF NOT EXISTS idx_pantry_items_custom_user_id ON pantry_items(custom_user_id);
