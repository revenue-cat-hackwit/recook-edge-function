-- Ensure constraint exists for upsert functionality
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'unique_user_date_meal_type'
    ) THEN
        ALTER TABLE meal_plans ADD CONSTRAINT unique_user_date_meal_type UNIQUE (user_id, date, meal_type);
    END IF;
END $$;
