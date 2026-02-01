ALTER TABLE user_recipes 
ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';

-- Create an index for faster searching by tags
CREATE INDEX IF NOT EXISTS idx_user_recipes_tags ON user_recipes USING GIN (tags);
