import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'jsr:@supabase/supabase-js@2'

console.log("Generate Recipe function initialized (Vision/Video Mode)")

interface RecipeRequest {
  videoUrl: string
  userPreferences?: {
    allergies: string[];
    dietGoal: string;
    equipment: string[];
  }
}

Deno.serve(async (req) => {
  try {
    // 1. Authorization Check
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), { status: 401 })
    }

    // 2. Parse Input (Strictly Video URL only)
    const { videoUrl, userPreferences } = await req.json() as RecipeRequest

    if (!videoUrl) {
      return new Response(JSON.stringify({ error: 'Video URL is required' }), { status: 400 })
    }
    
    // ... (Media Analysis Logic remains the same) ...

    // 2. Analyze Media Source
    console.log("Analyzing Media Source:", videoUrl);
    const mediaItems: { type: 'video' | 'image', url: string }[] = [];

    // Check if it is a social media link (TikTok/YouTube/IG/Twitter)
    const socialMediaRegex = /(tiktok\.com|youtube\.com|youtu\.be|instagram\.com|x\.com|twitter\.com)/;
    
    // Check for comma-separated list (Multi-Upload)
    const inputUrls = videoUrl.split(',').map(u => u.trim()).filter(Boolean);

    if (inputUrls.length > 1) {
         console.log(`Processing ${inputUrls.length} inputs...`);
         inputUrls.forEach(url => {
            if (/\.(mp4|mov)$/i.test(url)) {
                mediaItems.push({ type: 'video', url });
            } else {
                // Assume image for safety or check ext
                mediaItems.push({ type: 'image', url });
            }
         });
    } else {
        const singleUrl = inputUrls[0];

        // A. Direct File Link (e.g. Uploaded Image)
        if (/\.(jpg|jpeg|png|webp|heic)$/i.test(singleUrl)) {
            mediaItems.push({ type: 'image', url: singleUrl });
            console.log("Detected Direct Image URL");
        }
        // B. Social Media Link -> Cobalt extraction
        else if (socialMediaRegex.test(singleUrl)) {
            try {
                const cobaltApiUrl = "https://cobalt-production-6a89.up.railway.app/"; 
                
                const cobaltRes = await fetch(cobaltApiUrl, {
                    method: "POST",
                    headers: { "Accept": "application/json", "Content-Type": "application/json" },
                    body: JSON.stringify({ url: singleUrl })
                });

                const cobaltData = await cobaltRes.json();
    
                // Cobalt Response Handling...
                // (Note: Using `cobaltData` from scope)
                if (cobaltData.status === 'picker' && cobaltData.picker) {
                    // Multi-Media (Carousel)
                    console.log(`Detected Carousel with ${cobaltData.picker.length} items`);
                    cobaltData.picker.forEach((item: any) => {
                        if (item.type === 'photo') mediaItems.push({ type: 'image', url: item.url });
                        if (item.type === 'video') mediaItems.push({ type: 'video', url: item.url });
                    });
                } 
                else if (cobaltData.url) {
                    const isImage = /\.(jpg|jpeg|png|webp)$/i.test(cobaltData.url);
                    mediaItems.push({ type: isImage ? 'image' : 'video', url: cobaltData.url });
                } 
                else if (cobaltData.status === 'tunnel' || cobaltData.status === 'redirect') {
                    if (cobaltData.url) {
                        const isImage = /\.(jpg|jpeg|png|webp)$/i.test(cobaltData.url);
                        mediaItems.push({ type: isImage ? 'image' : 'video', url: cobaltData.url });
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
    console.log(`Prepared ${finalMediaItems.length} media items for AI`);

    // 3. Prepare AI Request for Novita AI
    const novitaApiKey = Deno.env.get('NOVITA_AI_API_KEY')
    if (!novitaApiKey) throw new Error('NOVITA_AI_API_KEY not configured');

    // 2b. Fetch User Context from DB (Source of Truth)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } }
    })
    
    let dbPreferences: any = {};
    let dbPantry: any[] = [];

    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
        // Fetch Profile
        const { data: profile } = await supabase.from('profiles').select('allergies, diet_goal, equipment').eq('id', user.id).single();
        if (profile) dbPreferences = profile;

        // Fetch Pantry (Optional: Use ingredients from pantry)
        const { data: pantry } = await supabase.from('pantry_items').select('ingredient_name').eq('user_id', user.id);
        if (pantry) dbPantry = pantry; // Could prompt AI to use these
    }

    // Merge: DB takes precedence over client-side if available, or fallback
    const finalPreferences = {
        allergies: dbPreferences.allergies || userPreferences?.allergies || [],
        dietGoal: dbPreferences.diet_goal || userPreferences?.dietGoal || '',
        equipment: dbPreferences.equipment || userPreferences?.equipment || []
    };

    let prefsPrompt = "";
    if (finalPreferences.allergies.length > 0) {
        prefsPrompt += `\nCRITICAL: The user has ALLERGIES to: ${finalPreferences.allergies.join(', ')}. Do NOT include these ingredients. Suggest safe alternatives if necessary.`;
    }
    if (finalPreferences.dietGoal) {
        prefsPrompt += `\nUser's diet goal is: ${finalPreferences.dietGoal}. Adjust portions or ingredients to align with this (e.g. less oil, more protein).`;
    }
    if (finalPreferences.equipment.length > 0) {
        prefsPrompt += `\nUser has these tools: ${finalPreferences.equipment.join(', ')}. Tailor instructions to use these tools.`;
    }
    if (dbPantry.length > 0) {
         const pantryNames = dbPantry.map((p: any) => p.ingredient_name).join(', ');
         prefsPrompt += `\nUser has these ingredients in PANTRY: ${pantryNames}. Try to use them if they fit the recipe.`;
    }

    console.log("Using User Prefs:", prefsPrompt);

    const systemPrompt = `You are "Pirinku Chef", an expert AI Chef. 
Your task is to analyze the provided media (video or images) and generate a precise cooking recipe.
Ignore non-food content.

${prefsPrompt}

OUTPUT JSON format exactly as requested:
{
  "title": "", "description": "", "time_minutes": 0, "difficulty": "", 
  "servings": 0, "calories_per_serving": 0, 
  "ingredients": [], "tools": [], "steps": [{"step": 1, "instruction": ""}], "tips": ""
}`;

    // Construct Multi-Modal User Content
    const userContent: any[] = [
        { type: "text", text: `Create a detailed recipe from this content. Source: ${videoUrl}` }
    ];

    finalMediaItems.forEach(item => {
        if (item.type === 'video') {
            userContent.push({ type: "video_url", video_url: { url: item.url } });
        } else {
            userContent.push({ type: "image_url", image_url: { url: item.url } });
        }
    });

    const requestPayload = {
      model: "qwen/qwen3-vl-30b-a3b-instruct", 
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent }
      ],
      max_tokens: 2000,
      temperature: 0.2,
      response_format: { type: "json_object" }
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

        // Try to capture a valid image URL for the thumbnail
        const firstImage = finalMediaItems.find(i => i.type === 'image');
        if (firstImage) {
            recipeData.imageUrl = firstImage.url;
        } else if (finalMediaItems.length > 0) {
             // Fallback to whatever URL we have (e.g. video)
             // The frontend might need to generate a thumbnail properly later
             recipeData.imageUrl = finalMediaItems[0].url; 
        }
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
