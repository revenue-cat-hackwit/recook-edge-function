import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, SupabaseClient } from 'jsr:@supabase/supabase-js@2'

console.log("Extract Media function initialized")

// --- HELPER: Re-host Video to Supabase ---
async function rehostVideo(sourceUrl: string, supabase: SupabaseClient): Promise<string> {
    try {
        // A. Check if already on Supabase (Skip re-upload)
        // Example pattern: https://[project-ref].supabase.co/storage/v1/object/public/videos/...
        if (sourceUrl.includes('supabase.co') && sourceUrl.includes('/storage/')) {
             console.log("Video already on Supabase, skipping re-upload.");
             return sourceUrl;
        }

        console.log("Re-hosting video to Supabase Storage...", sourceUrl);
        
        // B. Download from Source
        // Use a timeout to prevent hanging on slow streams
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60000); // 60s timeout

        const resp = await fetch(sourceUrl, { 
            signal: controller.signal,
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' 
            } 
        });
        clearTimeout(timeout);
        
        if (!resp.ok) throw new Error(`Failed to fetch source: ${resp.status}`);
        
        // C. Size Check (100MB Limit) & Content-Type Detection
        const sizeLimit = 100 * 1024 * 1024; // 100MB
        const contentLength = resp.headers.get('content-length');
        if (contentLength && parseInt(contentLength) > sizeLimit) {
            throw new Error("Media size exceeds 50MB limit");
        }

        const contentType = resp.headers.get('content-type') || 'application/octet-stream';
        // If it is an image, we can arguably just return the source URL if it's public.
        // BUT, for consistency and avoiding hotlinking protection, let's rehost everything if we are here.
        
        let ext = 'bin';
        let type: 'video' | 'image' = 'video';

        if (contentType.includes('image')) {
            type = 'image';
            ext = contentType.split('/')[1] || 'jpg';
        } else if (contentType.includes('video')) {
             type = 'video';
             ext = 'mp4'; // force mp4 extension for consistency or use split
        } else {
            // Fallback: try to guess from url
            if (/\.(jpg|jpeg|png|webp)$/i.test(sourceUrl)) { type = 'image'; ext = 'jpg'; }
            else { type = 'video'; ext = 'mp4'; }
        }

        const fileBlob = await resp.arrayBuffer();
        if (fileBlob.byteLength > sizeLimit) throw new Error("Media size exceeds 50MB limit");

        // D. Upload to Supabase 'videos' bucket (or 'images' if you had one, but 'videos' is fine for media)
        // We'll prefix filename to indicate type
        const filename = `ai_rehost_${type}_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: uploadError } = await supabase.storage
            .from('videos') // Storing all AI media in 'videos' bucket for simplicity
            .upload(filename, fileBlob, { 
                contentType: contentType, 
                upsert: false 
            });

        if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

        // E. Get Public URL
        const { data } = supabase.storage.from('videos').getPublicUrl(filename);
        
        // Return object with type to caller? No, this function returns string.
        // Caller needs to know type. 
        // We will attach a query param to the URL to hint type? Or just let caller check extension.
        return data.publicUrl; 


    } catch (e: any) {
        console.error("Re-hosting failed:", e.message);
        // Strict Requirement: Fail if cannot host (as requested by User)
        throw new Error(`Failed to process video: ${e.message}`);
    }
}

Deno.serve(async (req) => {
  try {
    // 1. Authorization Check
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), { status: 401 })
    }

    // 2. Initialize Supabase Client (Protected - Use Service Role Key to Bypass RLS)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')! 
    const supabase = createClient(supabaseUrl, supabaseKey, {
       auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })

    // 3. Parse Input
    const { videoUrl } = await req.json()
    if (!videoUrl) {
      return new Response(JSON.stringify({ error: 'Video URL is required' }), { status: 400 })
    }

    console.log("Analyzing Media Source:", videoUrl);
    const mediaItems: { type: 'video' | 'image', url: string }[] = [];

    // Check if it is a social media link (TikTok/YouTube/IG/Twitter)
    const socialMediaRegex = /(tiktok\.com|youtube\.com|youtu\.be|instagram\.com|x\.com|twitter\.com)/;
    
    // Check for comma-separated list (Multi-Upload)
    const inputUrls = videoUrl.split(',').map((u: string) => u.trim()).filter(Boolean);


    // -----------------------------------------


    // MAIN PROCESSING LOOP
    // Use sequential processing for safety/logging clarity, or Promise.all if needed. 
    // Given re-uploads are heavy, sequential might be safer for memory limits.
    for (const singleUrl of inputUrls) {
        
        // A. Direct File Link (Start with Extensions)
        if (/\.(jpg|jpeg|png|webp|heic)$/i.test(singleUrl)) {
             mediaItems.push({ type: 'image', url: singleUrl });
             console.log("Detected Direct Image URL");
        }
        else if (/\.(mp4|mov|webm)$/i.test(singleUrl) && !socialMediaRegex.test(singleUrl)) {
             // DIRECT VIDEO -> MUST REHOST
             const hostedUrl = await rehostVideo(singleUrl, supabase);
             mediaItems.push({ type: 'video', url: hostedUrl });
             console.log("Detected & Re-hosted Direct Video URL");
        }
        // B. Social Media Link -> Cobalt extraction
        else if (socialMediaRegex.test(singleUrl)) {
            try {
                const cobaltApiUrl = "https://cobalt-production-6a89.up.railway.app/"; 
                console.log("Calling Cobalt API...");
                
                const cobaltRes = await fetch(cobaltApiUrl, {
                    method: "POST",
                    headers: { "Accept": "application/json", "Content-Type": "application/json" },
                    body: JSON.stringify({ url: singleUrl })
                });

                const cobaltData = await cobaltRes.json();
                console.log("Cobalt Response:", JSON.stringify(cobaltData));

                // Extract URL(s)
                let extractedUrls: { type: 'video'|'image', url: string }[] = [];

                if (cobaltData.status === 'picker' && cobaltData.picker) {
                    // Carousel
                    cobaltData.picker.forEach((item: any) => {
                         if (item.type === 'video') extractedUrls.push({ type: 'video', url: item.url });
                         if (item.type === 'photo') extractedUrls.push({ type: 'image', url: item.url });
                    });
                } else if (cobaltData.url) {
                    // Single Item
                    // Check if it looks like an image
                     if (/\.(jpg|jpeg|png|webp)$/i.test(cobaltData.url)) {
                        extractedUrls.push({ type: 'image', url: cobaltData.url });
                     } else {
                        extractedUrls.push({ type: 'video', url: cobaltData.url });
                     }
                }

                // Process extracted items
                if (extractedUrls.length === 0) {
                     console.warn("Cobalt returned no usable URL", cobaltData);
                     // Fallback mechanism: Try to rehost the original URL if we are desperate? Likely wont work.
                     throw new Error("Could not extract media from social link");
                }

                for (const item of extractedUrls) {
                    if (item.type === 'video') {
                        // REHOST REQUIRED
                         const hosted = await rehostVideo(item.url, supabase);
                         mediaItems.push({ type: 'video', url: hosted });
                    } else {
                        mediaItems.push(item);
                    }
                }

            } catch (e: any) {
                console.error("Cobalt/Processing Error:", e);
                throw new Error(e.message || "Failed to process media");
            }
        }
        // C. Fallback (Unknown URL type)
        else {
             // Try to treat as direct video and rehost
             try {
                const hostedUrl = await rehostVideo(singleUrl, supabase);
                mediaItems.push({ type: 'video', url: hostedUrl });
             } catch (e) {
                 console.log("Fallback rehost failed. Assuming text or invalid.");
                 throw e;
             }
        }
    }

    // Limit items to avoid payload limits (Max 5 items)
    const finalMediaItems = mediaItems.slice(0, 5);
    
    return new Response(JSON.stringify({ 
        success: true, 
        data: {
            mediaItems: finalMediaItems,
            sourceUrl: videoUrl,
            // Helper for frontend convenience
            mainMediaUrl: finalMediaItems.length > 0 ? finalMediaItems[0].url : videoUrl
        }
    }), {
        headers: { 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error("Extract Media Function Error:", error);
    return new Response(JSON.stringify({ 
        success: false, 
        error: error.message 
    }), {
        status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
})
