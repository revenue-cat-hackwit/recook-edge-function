-- Create a public bucket for temporary content
INSERT INTO storage.buckets (id, name, public)
VALUES ('temp_content', 'temp_content', true)
ON CONFLICT (id) DO NOTHING;

-- Policy to allow authenticated users to upload
CREATE POLICY "Allow authenticated uploads"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'temp_content');

-- Policy to allow anonymous uploads (since Function might be anon role)
CREATE POLICY "Allow anon uploads"
ON storage.objects FOR INSERT TO anon
WITH CHECK (bucket_id = 'temp_content');

-- Policy to allow public reading
CREATE POLICY "Allow public reading"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'temp_content');
