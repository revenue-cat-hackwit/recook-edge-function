import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'jsr:@supabase/supabase-js@2'

console.log("Generate Food Image function initialized")

const NOVITA_API_KEY = Deno.env.get('NOVITA_AI_API_KEY');

Deno.serve(async (req) => {
  try {
    // 1. Auth Check
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), { status: 401 })
    }

    if (!NOVITA_API_KEY) {
        return new Response(JSON.stringify({ error: 'Server Config Error: API Key missing' }), { status: 500 })
    }

    // 2. Parse Input
    const { prompt } = await req.json();
    if (!prompt) {
        return new Response(JSON.stringify({ error: 'Prompt is required' }), { status: 400 })
    }

    console.log(`Generating image for prompt: ${prompt}`);

    // 3. Request Image Generation (Async)
    const genRes = await fetch('https://api.novita.ai/v3/async/qwen-image-txt2img', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${NOVITA_API_KEY}`
        },
        body: JSON.stringify({
            prompt: `Delicious food photography, professional lighting, 8k, highly detailed: ${prompt}`,
            size: "1024*1024" // Format: "width*height" with asterisk
        })
    });

    if (!genRes.ok) {
        const errText = await genRes.text();
        throw new Error(`Novita Generation Failed: ${errText}`);
    }

    const genData = await genRes.json();
    const taskId = genData.task_id;
    console.log(`Task ID: ${taskId} - Waiting for completion...`);

    // 4. Polling for Result
    let imageUrl = null;
    let attempts = 0;
    const maxAttempts = 60; // 60 seconds max timeout (image generation can take time)

    while (attempts < maxAttempts) {
        await new Promise(r => setTimeout(r, 2000)); // Wait 2 sec between checks

        const checkRes = await fetch(`https://api.novita.ai/v3/async/task-result?task_id=${taskId}`, {
            headers: {
                'Authorization': `Bearer ${NOVITA_API_KEY}`
            }
        });

        if (checkRes.ok) {
            const checkData = await checkRes.json();
            console.log(`Attempt ${attempts + 1}: Status =`, checkData.task?.status);
            
            // Check task.status according to Novita API response structure
            if (checkData.task?.status === 'TASK_STATUS_SUCCEED') {
                if(checkData.images && checkData.images.length > 0) {
                     imageUrl = checkData.images[0].image_url;
                }
                break;
            } else if (checkData.task?.status === 'TASK_STATUS_FAILED') {
                throw new Error(`Image Generation Task Failed: ${checkData.task.reason || 'Unknown error'}`);
            }
            // Continue polling if status is PROCESSING or QUEUED
        }
        attempts++;
    }

    if (!imageUrl) {
        throw new Error("Timeout waiting for image generation");
    }

    console.log("Image Generated Successfully:", imageUrl);

    // 5. Re-upload to Supabase Storage (Persistence)
    // Novita URLs might be temporary. We save it to our bucket.
    try {
        console.log("Persisting image to Supabase Storage...");
        const imageRes = await fetch(imageUrl);
        const imageBlob = await imageRes.blob();
        
        const fileName = `generated_${Date.now()}_${Math.random().toString(36).substring(7)}.png`;

        // Initialize Supabase Client
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!;
        const supabase = createClient(supabaseUrl, supabaseKey, {
            global: { headers: { Authorization: authHeader } }
        });

        const { error: uploadError } = await supabase.storage
            .from('videos') // Using 'videos' bucket as it is configured public
            .upload(fileName, imageBlob, {
                contentType: 'image/png',
                upsert: false
            });

        if (uploadError) {
            console.error("Storage Upload Error:", uploadError);
            // Fallback: Return original URL if upload fails
        } else {
            const { data: publicData } = supabase.storage.from('videos').getPublicUrl(fileName);
            console.log("Persisted URL:", publicData.publicUrl);
            imageUrl = publicData.publicUrl;
        }

    } catch (persistError) {
        console.error("Persistence failed:", persistError);
        // Continue with original URL
    }

    return new Response(JSON.stringify({ success: true, imageUrl: imageUrl }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error("Generate Image Error:", error);
    return new Response(JSON.stringify({ 
        success: false, 
        error: error.message 
      }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
})
