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

    // 2. Initialize Supabase Client (Needed for Re-upload logic)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } }
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
                console.log("Cobalt Response Status:", cobaltData.status);
    
                if (cobaltData.status === 'picker' && cobaltData.picker) {
                    // Multi-Media (Carousel)
                    console.log(`Detected Carousel with ${cobaltData.picker.length} items`);
                    cobaltData.picker.forEach((item: any) => {
                        const finalUrl = item.url;
                        
                        if (item.type === 'photo') mediaItems.push({ type: 'image', url: item.url });
                        if (item.type === 'video') mediaItems.push({ type: 'video', url: finalUrl });
                    });
                } 
                else if (cobaltData.url) {
                    const isImage = /\.(jpg|jpeg|png|webp)$/i.test(cobaltData.url);
                    let finalUrl = cobaltData.url;


                    mediaItems.push({ type: isImage ? 'image' : 'video', url: finalUrl });
                } 
                else if (cobaltData.status === 'tunnel' || cobaltData.status === 'redirect') {
                    if (cobaltData.url) {
                        const isImage = /\.(jpg|jpeg|png|webp)$/i.test(cobaltData.url);
                        
                        // IF VIDEO TUNNEL: Re-upload to Supabase Storage to get a clean Direct Link
                        if (!isImage) {
                            console.log("Re-uploading Cobalt tunnel stream to Supabase Storage (Streaming)...");
                            try {
                                // 1. Fetch the stream from Cobalt
                                const tunnelRes = await fetch(cobaltData.url);
                                if (!tunnelRes.ok) throw new Error(`Failed to fetch tunnel stream: ${tunnelRes.status}`);
                                
                                // Use ArrayBuffer instead of stream for better compatibility
                                const videoBlob = await tunnelRes.arrayBuffer();

                                // 2. Upload to 'temp_content' bucket
                                const filename = `temp_${Date.now()}_${Math.random().toString(36).substring(7)}.mp4`;
                                const { data: uploadData, error: uploadError } = await supabase
                                    .storage
                                    .from('temp_content')
                                    .upload(filename, videoBlob, {
                                        contentType: 'video/mp4',
                                        upsert: false
                                    });

                                if (uploadError) throw uploadError;

                                // 3. Get Public URL
                                const { data: publicUrlData } = supabase
                                    .storage
                                    .from('temp_content')
                                    .getPublicUrl(filename);
                                
                                console.log("Re-uploaded Video URL:", publicUrlData.publicUrl);
                                mediaItems.push({ type: 'video', url: publicUrlData.publicUrl });
                            } catch (uploadErr) {
                                console.error("Re-upload failed, falling back to original tunnel (likely to fail):", uploadErr);
                                mediaItems.push({ type: 'video', url: cobaltData.url });
                            }
                        } else {
                            mediaItems.push({ type: 'image', url: cobaltData.url });
                        }
                    }
                } else {
                    console.warn("Cobalt unknown response, using original URL as fallback.");
                    mediaItems.push({ type: 'video', url: singleUrl });
                }

            } catch (e) {
                console.error("Cobalt Error, fallback to original:", e);
                mediaItems.push({ type: 'video', url: singleUrl });
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
