-- Fix Storage Bucket Permissions
-- This migration ensures that the 'videos' and 'images' buckets exist and are publicly accessible.
-- It also sets up standard RLS policies for viewing and uploading.

-- 1. Ensure 'videos' bucket exists and is public
INSERT INTO storage.buckets (id, name, public)
VALUES ('videos', 'videos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- 2. Ensure 'images' bucket exists and is public
INSERT INTO storage.buckets (id, name, public)
VALUES ('images', 'images', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- 3. Reset Policies to avoid conflicts (Safe Reload)
DO $$
BEGIN
    BEGIN EXECUTE 'DROP POLICY "Public Access Videos" ON storage.objects'; EXCEPTION WHEN OTHERS THEN END;
    BEGIN EXECUTE 'DROP POLICY "Auth Upload Videos" ON storage.objects'; EXCEPTION WHEN OTHERS THEN END;
    BEGIN EXECUTE 'DROP POLICY "Public Access Images" ON storage.objects'; EXCEPTION WHEN OTHERS THEN END;
    BEGIN EXECUTE 'DROP POLICY "Auth Upload Images" ON storage.objects'; EXCEPTION WHEN OTHERS THEN END;
END $$;

-- 4. Re-create Policies

-- Videos: Public Read, Auth Write
CREATE POLICY "Public Access Videos"
ON storage.objects FOR SELECT
USING ( bucket_id = 'videos' );

CREATE POLICY "Auth Upload Videos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK ( bucket_id = 'videos' );

-- Images: Public Read, Auth Write
CREATE POLICY "Public Access Images"
ON storage.objects FOR SELECT
USING ( bucket_id = 'images' );

CREATE POLICY "Auth Upload Images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK ( bucket_id = 'images' );
