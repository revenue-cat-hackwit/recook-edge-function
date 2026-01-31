-- Enable RLS for user_recipes (if not already enabled)
ALTER TABLE user_recipes ENABLE ROW LEVEL SECURITY;

-- 1. INSERT: Authenticated users can create their own recipes
CREATE POLICY "Users can create their own recipes" 
ON user_recipes 
FOR INSERT 
TO authenticated 
WITH CHECK (auth.uid() = user_id);

-- 2. SELECT: Users can view their own recipes
CREATE POLICY "Users can view their own recipes" 
ON user_recipes 
FOR SELECT 
TO authenticated 
USING (auth.uid() = user_id);

-- 3. UPDATE: Users can update their own recipes
CREATE POLICY "Users can update their own recipes" 
ON user_recipes 
FOR UPDATE 
TO authenticated 
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- 4. DELETE: Users can delete their own recipes
CREATE POLICY "Users can delete their own recipes" 
ON user_recipes 
FOR DELETE 
TO authenticated 
USING (auth.uid() = user_id);
