import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'jsr:@supabase/supabase-js@2'

console.log("Generate Recipe function initialized (Vision/Video Mode)")

interface RecipeRequest {
  videoUrl: string
}

Deno.serve(async (req) => {
  try {
    // 1. Authorization Check
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), { status: 401 })
    }

    // 2. Parse Input (Strictly Video URL only)
    const { videoUrl } = await req.json() as RecipeRequest

    if (!videoUrl) {
      return new Response(JSON.stringify({ error: 'Video URL is required' }), { status: 400 })
    }

    // 2. Analyze Video Source
    // console.log("Analyzing Video Source:", videoUrl);
    let finalVideoUrl = videoUrl;

    // Check if it is a social media link (TikTok/YouTube/IG/Twitter)
    const socialMediaRegex = /(tiktok\.com|youtube\.com|youtu\.be|instagram\.com|x\.com|twitter\.com)/;
    if (socialMediaRegex.test(videoUrl)) {
        // console.log("Social media link detected, using Self-Hosted Cobalt to extract real video...");
        
        try {
            // Using User's Self-Hosted Cobalt Instance (Confirmed Working)
            // Note: Cobalt v10+ uses root endpoint for API
            const cobaltApiUrl = "https://cobalt-production-6a89.up.railway.app/"; 
            
            const cobaltRes = await fetch(cobaltApiUrl, {
                method: "POST",
                headers: {
                    "Accept": "application/json",
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    url: videoUrl
                })
            });

            const cobaltData = await cobaltRes.json();
            // console.log("Cobalt Response:", cobaltData);

            if (cobaltData.url) {
                finalVideoUrl = cobaltData.url;
                // console.log("Successfully extracted video URL");
            } else if (cobaltData.status === 'tunnel' && cobaltData.url) {
                 finalVideoUrl = cobaltData.url;
                 // console.log("Successfully extracted Tunnel video URL");
            } else if (cobaltData.status === 'redirect' && cobaltData.url) {
                 finalVideoUrl = cobaltData.url;
                 // console.log("Successfully extracted Redirect video URL");
            } else {
                console.warn("Cobalt failed to extract video or returned unknown format.");
                // We fallback to original URL
            }



            // BRIDGE: Upload to Supabase Storage to standardize the URL (remove attachment headers, etc)
            console.log("Bridging video to Supabase Storage...");
            try {
                const videoRes = await fetch(finalVideoUrl);
                if (videoRes.ok) {
                   const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
                   const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
                   const supabase = createClient(supabaseUrl, supabaseServiceKey);

                   // Use ArrayBuffer to avoid stream compatibility issues in some edge versions
                   const videoBlob = await videoRes.arrayBuffer(); 
                   const fileName = `ai_cache/${Date.now()}.mp4`;

                   const { error: uploadError } = await supabase.storage
                        .from('videos')
                        .upload(fileName, videoBlob, {
                            contentType: 'video/mp4',
                            upsert: true
                        });
                    
                   if (!uploadError) {
                       const { data: { publicUrl } } = supabase.storage
                            .from('videos')
                            .getPublicUrl(fileName);
                        
                        finalVideoUrl = publicUrl;
                        console.log("Bridged Video URL:", finalVideoUrl);
                   } else {
                       console.error("Bridge upload failed:", uploadError);
                   }
                }
            } catch (bridgeError) {
                 console.error("Bridge failed:", bridgeError);
            }

        } catch (e) {
            console.error("Cobalt API Error:", e);
        }
    }

    console.log("Final Video URL extracted");

    // 3. Prepare AI Request for Novita AI (Qwen-VL or compatible)
    const novitaApiKey = Deno.env.get('NOVITA_AI_API_KEY')
    if (!novitaApiKey) throw new Error('NOVITA_AI_API_KEY not configured');

    const systemPrompt = `You are "Pirinku Chef", an expert AI Chef. 
Your task is to watch the provided video and generate a precise cooking recipe based on what is shown.
Ignote any non-food content. If the video is not about cooking, return an error in the JSON.
If the video URL is invalid or blocked, try to infer the recipe from any available metadata or return a polite error.

OUTPUT FORMAT (JSON ONLY):
{
  "title": "Recipe Name",
  "description": "Brief description of the dish",
  "time_minutes": 30,
  "difficulty": "Easy",
  "servings": 2,
  "calories_per_serving": 400,
  "ingredients": ["Item 1", "Item 2"],
  "tools": ["Tool 1", "Tool 2"],
  "steps": [
    { "step": 1, "instruction": "Step 1 details..." },
    { "step": 2, "instruction": "Step 2 details..." }
  ],
  "tips": "A helpful chef tip"
}
Do not use markdown formatting. Return raw JSON.`;

    // Construct the payload exactly as requested for Video Input
    const requestPayload = {
      model: "qwen/qwen3-vl-30b-a3b-instruct", // Back to user requested model
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Please watch this video and create a detailed recipe from it. Original Link: ${videoUrl}`
            },
            {
              type: "video_url",
              video_url: {
                url: finalVideoUrl
              }
            }
          ]
        }
      ],
      max_tokens: 2000,
      temperature: 0.2, // Lower temperature for more accurate extraction
      response_format: { type: "json_object" } // Force JSON if supported, otherwise system prompt handles it
    };

    console.log("Sending to AI...");

    // 4. Call Novita AI
    const aiRes = await fetch('https://api.novita.ai/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${novitaApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestPayload)
    });

    if (!aiRes.ok) {
        const errorText = await aiRes.text();
        console.error("AI API Error:", errorText);
        throw new Error(`AI Provider Error: ${errorText}`);
    }

    const aiJson = await aiRes.json();
    console.log("AI Response received");
    
    const content = aiJson.choices[0].message.content;

    // 5. Parse JSON
    let recipeData;
    try {
        // Clean up any markdown code blocks if present
        const cleanJson = content.replace(/```json/g, '').replace(/```/g, '').trim();
        recipeData = JSON.parse(cleanJson);
        
        // Append source URL for reference
        recipeData.sourceUrl = videoUrl;
    } catch (e) {
        console.error("JSON Parse Error. Raw content:", content);
        throw new Error("Failed to parse recipe from AI response");
    }

    return new Response(JSON.stringify({ success: true, data: recipeData }), {
      headers: { 'Content-Type': 'application/json' }
    });

    }
catch (error: any) {
    console.error("Function Error:", error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
})
