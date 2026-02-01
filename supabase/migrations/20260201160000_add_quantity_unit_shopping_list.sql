-- Add quantity and unit columns to shopping_list_items
ALTER TABLE shopping_list_items
ADD COLUMN IF NOT EXISTS quantity NUMERIC,
ADD COLUMN IF NOT EXISTS unit TEXT;
