ALTER TABLE user_recipes ADD COLUMN collections text[] DEFAULT '{}';
CREATE INDEX idx_user_recipes_collections ON user_recipes USING GIN (collections);
