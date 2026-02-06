-- Migration to support idea-based meal plans (decoupling meal plans from recipes table)

-- 1. Make recipe_id nullable (so we don't have to create a placeholder recipe)
ALTER TABLE meal_plans ALTER COLUMN recipe_id DROP NOT NULL;

-- 2. Add columns to store the "Idea" details directly in the meal_plans table
ALTER TABLE meal_plans ADD COLUMN IF NOT EXISTS idea_title TEXT;
ALTER TABLE meal_plans ADD COLUMN IF NOT EXISTS idea_description TEXT;
ALTER TABLE meal_plans ADD COLUMN IF NOT EXISTS idea_image_url TEXT; -- Optional generated image for the idea

-- 3. Add a constraint ensuring either a recipe OR an idea title is present
-- This prevents "empty" meal plans
ALTER TABLE meal_plans ADD CONSTRAINT check_recipe_or_idea 
CHECK (
  (recipe_id IS NOT NULL) OR (idea_title IS NOT NULL)
);

-- 4. (Optional) Data Migration for existing Placeholders
-- If you want to clean up existing data, you would run a script to copy 'placeholder' recipes
-- data into the 'idea_title' column and then set recipe_id to null.
-- For now, we leave existing data as is.
