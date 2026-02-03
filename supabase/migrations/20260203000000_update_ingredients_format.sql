-- Migration: Update ingredients format from string[] to structured object[]
-- This migration updates existing recipes to use the new ingredient format
-- Date: 2026-02-03

-- Step 1: Update the comment on ingredients column to reflect new structure
COMMENT ON COLUMN user_recipes.ingredients IS 'Structured ingredients as JSONB array: [{item: "Chicken", quantity: 200, unit: "g"}]';

-- Step 2: Create a function to migrate old ingredient format to new format
-- This function attempts to parse string ingredients like "200g Chicken" into structured format
CREATE OR REPLACE FUNCTION migrate_ingredient_to_structured(ingredient_text TEXT)
RETURNS JSONB AS $$
DECLARE
  result JSONB;
  qty TEXT;
  unit_text TEXT;
  item_name TEXT;
BEGIN
  -- Try to match pattern: "number unit item" (e.g., "200 g Chicken" or "200g Chicken")
  IF ingredient_text ~ '^[\d./]+\s*[a-zA-Z]+\s+.+$' THEN
    -- Extract quantity, unit, and item
    qty := (regexp_match(ingredient_text, '^([\d./]+)'))[1];
    unit_text := (regexp_match(ingredient_text, '^[\d./]+\s*([a-zA-Z]+)'))[1];
    item_name := regexp_replace(ingredient_text, '^[\d./]+\s*[a-zA-Z]+\s+', '');
    
    result := jsonb_build_object(
      'item', item_name,
      'quantity', qty,
      'unit', unit_text
    );
  -- Try to match pattern: "number item" (e.g., "2 Eggs")
  ELSIF ingredient_text ~ '^[\d./]+\s+.+$' THEN
    qty := (regexp_match(ingredient_text, '^([\d./]+)'))[1];
    item_name := regexp_replace(ingredient_text, '^[\d./]+\s+', '');
    
    result := jsonb_build_object(
      'item', item_name,
      'quantity', qty,
      'unit', 'pcs'
    );
  -- Default: treat whole string as item with quantity 1
  ELSE
    result := jsonb_build_object(
      'item', ingredient_text,
      'quantity', '1',
      'unit', 'pcs'
    );
  END IF;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Step 3: Migrate existing recipes (if any have old format)
-- This updates recipes where ingredients is an array of strings to the new structured format
DO $$
DECLARE
  recipe_row RECORD;
  old_ingredients JSONB;
  new_ingredients JSONB;
  ingredient_item JSONB;
BEGIN
  -- Loop through all recipes
  FOR recipe_row IN 
    SELECT id, ingredients 
    FROM user_recipes 
    WHERE ingredients IS NOT NULL
  LOOP
    old_ingredients := recipe_row.ingredients;
    new_ingredients := '[]'::JSONB;
    
    -- Check if first ingredient is a string (old format)
    IF jsonb_typeof(old_ingredients->0) = 'string' THEN
      -- Convert each string ingredient to structured format
      FOR ingredient_item IN SELECT * FROM jsonb_array_elements(old_ingredients)
      LOOP
        new_ingredients := new_ingredients || jsonb_build_array(
          migrate_ingredient_to_structured(ingredient_item#>>'{}')
        );
      END LOOP;
      
      -- Update the recipe with new format
      UPDATE user_recipes 
      SET ingredients = new_ingredients 
      WHERE id = recipe_row.id;
      
      RAISE NOTICE 'Migrated recipe %', recipe_row.id;
    END IF;
  END LOOP;
END $$;

-- Step 4: Also update community_posts recipe_snapshot if needed
DO $$
DECLARE
  post_row RECORD;
  old_snapshot JSONB;
  new_snapshot JSONB;
  old_ingredients JSONB;
  new_ingredients JSONB;
  ingredient_item JSONB;
BEGIN
  FOR post_row IN 
    SELECT id, recipe_snapshot 
    FROM community_posts 
    WHERE recipe_snapshot->'ingredients' IS NOT NULL
  LOOP
    old_snapshot := post_row.recipe_snapshot;
    old_ingredients := old_snapshot->'ingredients';
    
    -- Check if first ingredient is a string (old format)
    IF jsonb_typeof(old_ingredients->0) = 'string' THEN
      new_ingredients := '[]'::JSONB;
      
      -- Convert each string ingredient to structured format
      FOR ingredient_item IN SELECT * FROM jsonb_array_elements(old_ingredients)
      LOOP
        new_ingredients := new_ingredients || jsonb_build_array(
          migrate_ingredient_to_structured(ingredient_item#>>'{}')
        );
      END LOOP;
      
      -- Update the snapshot with new ingredients
      new_snapshot := old_snapshot || jsonb_build_object('ingredients', new_ingredients);
      
      UPDATE community_posts 
      SET recipe_snapshot = new_snapshot 
      WHERE id = post_row.id;
      
      RAISE NOTICE 'Migrated community post %', post_row.id;
    END IF;
  END LOOP;
END $$;

-- Step 5: Clean up the migration function (optional, keep it for future use)
-- DROP FUNCTION IF EXISTS migrate_ingredient_to_structured(TEXT);

-- Add helpful comment
COMMENT ON FUNCTION migrate_ingredient_to_structured IS 'Helper function to parse old string ingredients into structured format {item, quantity, unit}';
