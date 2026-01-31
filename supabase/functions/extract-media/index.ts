import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'jsr:@supabase/supabase-js@2'

console.log("Extract Media function initialized")

Deno.serve(async (req) => {
  try {
    // 1. Authorization Check
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), { status: 401 })
    }

    // 2. Initialize Supabase Client (Protected - Use Service Role Key to Bypass RLS)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')! // Changed from ANON_KEY
    const supabase = createClient(supabaseUrl, supabaseKey, {
      // No global auth header needed for admin tasks, but we can keep it if we want to respect user context for Row Level Security if we *wanted* to. 
      // But for system uploads, we want admin rights.
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

    if (inputUrls.length > 1) {
         console.log(`Processing ${inputUrls.length} inputs...`);
         inputUrls.forEach((url: string) => {
            if (/\.(mp4|mov)$/i.test(url)) {
                mediaItems.push({ type: 'video', url });
            } else {
                // Assume image for safety or check ext
                mediaItems.push({ type: 'image', url });
            }
         });
    } else {
        const singleUrl = inputUrls[0];

        // A. Direct File Link (e.g. Uploaded Image or already processed URL)
        if (/\.(jpg|jpeg|png|webp|heic)$/i.test(singleUrl)) {
            mediaItems.push({ type: 'image', url: singleUrl });
            console.log("Detected Direct Image URL");
        }
        else if (/\.(mp4|mov|webm)$/i.test(singleUrl) && !socialMediaRegex.test(singleUrl)) {
             mediaItems.push({ type: 'video', url: singleUrl });
             console.log("Detected Direct Video URL");
        }
        // B. Social Media Link -> Cobalt extraction
        else if (socialMediaRegex.test(singleUrl)) {
            try {
                const cobaltApiUrl = "https://cobalt-production-6a89.up.railway.app/"; 
                console.log("Calling Cobalt API...");
                
                const cobaltRes = await fetch(cobaltApiUrl, {
                    method: "POST",
                    headers: { "Accept": "application/json", "Content-Type": "application/json" },
                    body: JSON.stringify({ 
                        url: singleUrl,
                    })
                });
                const cobaltData = await cobaltRes.json();
                console.log("Cobalt Response:", JSON.stringify(cobaltData));

                // 1. Get the Raw URL from Cobalt (whatever it is)
                let rawUrl = "";
                if (cobaltData.url) rawUrl = cobaltData.url;
                else if (cobaltData.picker && cobaltData.picker.length > 0) rawUrl = cobaltData.picker[0].url;

                if (!rawUrl) {
                    throw new Error("Cobalt did not return a URL");
                }

                // 2. CHECK: Is it already an image? (Images are safe, usually)
                // If it's an image, just pass it through. If video/stream, ALWAYS RE-UPLOAD.
                const isImage = /\.(jpg|jpeg|png|webp|heic)$/i.test(rawUrl.split('?')[0]);

                if (isImage) {
                     mediaItems.push({ type: 'image', url: rawUrl });
                } else {
                     // 3. VIDEO FLOW: FORCE DOWNLOAD & UPLOAD
                     console.log(`Processing Video URL: ${rawUrl}`);
                     console.log("Starting Download & Re-upload sequence...");

                     try {
                        // A. Download from Cobalt/Source
                        const downloadRes = await fetch(rawUrl, {
                             headers: { 'User-Agent': 'Mozilla/5.0' } // Fake UA
                        });
                        
                        if (!downloadRes.ok) throw new Error(`Download failed: ${downloadRes.status}`);
                        
                        // Size Check (50MB Limit for "Shorts")
                        const maxSize = 50 * 1024 * 1024; 
                        const cl = downloadRes.headers.get('content-length');
                        if (cl && parseInt(cl) > maxSize) throw new Error("Video too large (Max 50MB)");

                        const fileBlob = await downloadRes.arrayBuffer();
                        if (fileBlob.byteLength > maxSize) throw new Error("Video too large (Max 50MB)");
                        
                        // B. Upload to Supabase 'videos' bucket
                        const filename = `ai_${Date.now()}.mp4`; // Always save as .mp4
                        
                        console.log(`Uploading ${fileBlob.byteLength} bytes to Supabase...`);
                        
                        const { error: uploadError } = await supabase.storage
                            .from('videos')
                            .upload(filename, fileBlob, { 
                                contentType: 'video/mp4', 
                                upsert: false 
                            });

                        if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

                        // C. Get Public URL
                        const { data: publicUrlData } = supabase.storage
                            .from('videos')
                            .getPublicUrl(filename);

                        console.log("Final Hosted URL:", publicUrlData.publicUrl);
                        mediaItems.push({ type: 'video', url: publicUrlData.publicUrl });

                     } catch (err: any) {
                         console.error("Critical Failure in Download-Upload Pipeline:", err);
                         throw new Error(`Failed to secure video file: ${err.message}. Please upload manually.`);
                     }
                }

            } catch (e: any) {
                console.error("Cobalt/Processing Error:", e);
                // DO NOT FALLBACK. Let it fail so user knows to upload manually.
                throw new Error(e.message || "Failed to process media");
            }
        }
        // C. Fallback
        else {
            mediaItems.push({ type: 'video', url: singleUrl });
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
