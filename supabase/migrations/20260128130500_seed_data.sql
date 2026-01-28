
-- SEED DATA for Pirinku
-- This migration inserts initial demo data for the Feed and Pantry.

DO $$
DECLARE
  v_user_id UUID;
  v_recipe_id UUID;
BEGIN
  -- GET A USER ID (First user found)
  SELECT id INTO v_user_id FROM auth.users LIMIT 1;

  -- If no user exists, we cannot seed user-linked data.
  IF v_user_id IS NULL THEN
     RAISE NOTICE 'No users found. Skipping seed data.';
     RETURN;
  END IF;

  RAISE NOTICE 'Seeding data for User ID: %', v_user_id;

  -- 2. Insert Sample Recipe: Nasi Goreng
  INSERT INTO user_recipes (user_id, title, description, ingredients, steps, image_url, is_public, time_minutes, difficulty, calories_per_serving)
  VALUES 
  (
    v_user_id,
    'Classic Nasi Goreng',
    'Indonesian fried rice with sweet soy sauce and spices.',
    '["2 cups of rice", "2 tbsp sweet soy sauce", "1 egg", "2 shallots", "1 clove garlic", "Chili to taste"]',
    '[{"step": 1, "instruction": "Mash garlic, shallots, and chili."}, {"step": 2, "instruction": "Stir fry the paste until fragrant."}, {"step": 3, "instruction": "Add egg and scramble."}, {"step": 4, "instruction": "Add rice and soy sauce. Mix well."}]',
    'https://images.unsplash.com/photo-1603133872878-684f10842619?q=80&w=1000&auto=format&fit=crop',
    true,
    '15 min',
    'Easy',
    '350 kcal'
  ) RETURNING id INTO v_recipe_id;

  -- 3. Publish to Community Posts
  INSERT INTO community_posts (user_id, original_recipe_id, title, image_url, recipe_snapshot, likes_count)
  VALUES
  (
    v_user_id,
    v_recipe_id,
    'Classic Nasi Goreng',
    'https://images.unsplash.com/photo-1603133872878-684f10842619?q=80&w=1000&auto=format&fit=crop',
    '{"title": "Classic Nasi Goreng", "steps": [{"step": 1, "instruction": "Mash garlic, shallots, and chili."}, {"step": 2, "instruction": "Stir fry the paste until fragrant."}, {"step": 3, "instruction": "Add egg and scramble."}, {"step": 4, "instruction": "Add rice and soy sauce. Mix well."}], "ingredients": ["2 cups of rice", "2 tbsp sweet soy sauce", "1 egg", "2 shallots", "1 clove garlic", "Chili to taste"]}'::jsonb,
    15
  );

  -- 4. Another Recipe: Avocado Toast (No local recipe link)
  INSERT INTO community_posts (user_id, original_recipe_id, title, image_url, recipe_snapshot, likes_count)
  VALUES
  (
    v_user_id,
    NULL,
    'Ultimate Avocado Toast',
    'https://images.unsplash.com/photo-1541519227333-84412215c20e?q=80&w=1000&auto=format&fit=crop',
    '{"title": "Ultimate Avocado Toast", "steps": [{"step": 1, "instruction": "Toast the sourdough bread until golden."}, {"step": 2, "instruction": "Mash avocado with lemon juice, salt, and chili flakes."}, {"step": 3, "instruction": "Spread on toast and top with poached egg."}], "ingredients": ["Sourdough Bread", "1 Ripe Avocado", "Lemon Juice", "Chili Flakes", "1 Egg"]}'::jsonb,
    42
  );
  
  -- 5. Another Recipe: Smoothie Bowl
   INSERT INTO community_posts (user_id, original_recipe_id, title, image_url, recipe_snapshot, likes_count)
  VALUES
  (
    v_user_id,
    NULL,
    'Berry Smoothie Bowl',
    'https://images.unsplash.com/photo-1623855244697-5d8fbe9c7992?q=80&w=1000&auto=format&fit=crop',
    '{"title": "Berry Smoothie Bowl", "steps": [{"step": 1, "instruction": "Blend frozen berries, banana, and yogurt."}, {"step": 2, "instruction": "Pour into bowl and top with granola and chia seeds."}], "ingredients": ["Frozen Mixed Berries", "1 Banana", "Greek Yogurt", "Granola", "Chia Seeds"]}'::jsonb,
    89
  );

  -- 6. Seed PANTRY ITEMS
  INSERT INTO pantry_items (user_id, ingredient_name, quantity, category, expiry_date)
  VALUES
  (v_user_id, 'Milk', '1 Liter', 'Dairy', NOW() + INTERVAL '5 days'),
  (v_user_id, 'Eggs', '6 pcs', 'Dairy', NOW() + INTERVAL '10 days'),
  (v_user_id, 'Spinach', '1 bunch', 'Produce', NOW() + INTERVAL '2 days'),
  (v_user_id, 'Chicken Breast', '500g', 'Meat', NOW() + INTERVAL '3 days');

  -- 7. Seed PANTRY CATEGORIES
  INSERT INTO pantry_categories (name, keywords)
  VALUES
  ('Dairy', ARRAY['milk', 'cheese', 'yogurt', 'butter', 'cream']),
  ('Produce', ARRAY['apple', 'banana', 'carrot', 'onion', 'garlic', 'spinach', 'lettuce', 'tomato', 'vegetable', 'fruit']),
  ('Meat', ARRAY['chicken', 'beef', 'pork', 'fish', 'lamb', 'steak', 'sausage']),
  ('Grains', ARRAY['rice', 'pasta', 'bread', 'quinoa', 'oats', 'flour']),
  ('Spices', ARRAY['salt', 'pepper', 'sugar', 'cinnamon', 'paprika']);

  -- 8. Seed REFERENCE DATA
  INSERT INTO reference_allergies (name)
  VALUES ('Peanuts'), ('Seafood'), ('Dairy'), ('Gluten'), ('Eggs'), ('Soy'), ('Tree Nuts')
  ON CONFLICT (name) DO NOTHING;

  INSERT INTO reference_equipment (name)
  VALUES ('Oven'), ('Blender'), ('Air Fryer'), ('Microwave'), ('Mixer'), ('Stove'), ('Knife'), ('Rice Cooker')
  ON CONFLICT (name) DO NOTHING;

END $$;
