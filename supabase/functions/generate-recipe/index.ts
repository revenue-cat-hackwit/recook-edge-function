import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'jsr:@supabase/supabase-js@2'

console.log("Generate Recipe function initialized (AI Mode Only)")

interface RecipeRequest {
  mediaItems: { type: 'video' | 'image', url: string }[]
  userPreferences?: {
    allergies: string[];
    dietGoal: string;
    equipment: string[];
  }
  // Optional: Backwards compatibility or single URL pass-through
  videoUrl?: string
}

Deno.serve(async (req) => {
  try {
    // 1. Authorization Check
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), { status: 401 })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } }
    })

    // 2. Parse Input
    const { mediaItems, userPreferences, videoUrl, title, description } = await req.json() as RecipeRequest & { title?: string, description?: string }

    // Validate Input
    let finalMediaItems = mediaItems || [];
    const isTextOnly = (!finalMediaItems || finalMediaItems.length === 0) && (!videoUrl);

    if (isTextOnly) {
        if (!title) {
             return new Response(JSON.stringify({ error: 'Title is required for text-only generation' }), { status: 400 })
        }
    } else {
         if (!finalMediaItems || finalMediaItems.length === 0) {
            if (videoUrl) {
                finalMediaItems = [{ type: 'video', url: videoUrl }];
            }
        }
    }

    console.log(`Processing recipe generation. Mode: ${isTextOnly ? 'Text-Only' : 'Multi-Modal'}`);

    // 3. Prepare AI Request
    const novitaApiKey = Deno.env.get('NOVITA_AI_API_KEY')
    if (!novitaApiKey) throw new Error('NOVITA_AI_API_KEY not configured');

    // ... (User Context fetching remains same, skipping lines 51-88 in replacement if possible, but for clarity I will keep flow or assume context is fetched)
    // To minimize replacement size, I will assume lines 51-88 are fine.
    // However, I need to wrap the payload construction logic based on mode.

    // ... User Context Logic (Keep existing lines 51-89) ... 
    // I will replace from line 90 downwards to handle the branching.

    // 4. Fetch User Context from DB (Source of Truth)
    let dbPreferences: any = {};
    let dbPantry: any[] = [];

    const { data: { user } } = await supabase.auth.getUser();
    
    if (user) {
        const [profileRes, pantryRes] = await Promise.all([
            supabase.from('profiles').select('allergies, diet_goal, equipment').eq('id', user.id).single(),
            supabase.from('pantry_items').select('ingredient_name').eq('user_id', user.id)
        ]);

        if (profileRes.data) dbPreferences = profileRes.data;
        if (pantryRes.data) dbPantry = pantryRes.data;
    }

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

    let requestPayload;
    
    // --- MODE A: TEXT ONLY (Llama 3) ---
    if (isTextOnly) {
         const systemPrompt = `You are "Pirinku Chef", an expert AI Chef.
Generate a detailed recipe based on the Title and Description provided.
${prefsPrompt}

OUTPUT JSON ONLY:
{
  "title": "${title}", "description": "Extended description...", 
  "time_minutes": Number, "difficulty": "String", 
  "servings": Number, "calories_per_serving": Number,
  "ingredients": ["String", "String"], 
  "tools": ["String"], 
  "steps": [{"step": 1, "instruction": "String"}], 
  "tips": "String"
}`;

        requestPayload = {
            model: "meta-llama/llama-3-70b-instruct",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: `Recipe Title: ${title}\nDescription: ${description || 'No description'}` }
            ],
            max_tokens: 2000,
            temperature: 0.4,
            response_format: { type: "json_object" }
        };
    } 
    // --- MODE B: MULTI-MODAL (Qwen-VL) ---
    else {
        const systemPrompt = `You are "Pirinku Chef", an expert AI Chef. 
Your task is to analyze the provided media (video or images) and generate a precise cooking recipe.
${prefsPrompt}

OUTPUT JSON ONLY (No Markdown):
{
  "title": "String", "description": "String", 
  "time_minutes": Number, "difficulty": "String", 
  "servings": Number, "calories_per_serving": Number,
  "ingredients": ["String", "String"], 
  "tools": ["String"], 
  "steps": [{"step": 1, "instruction": "String"}], 
  "tips": "String"
}`;
        
        const userContent: any[] = [
            { type: "text", text: `Create a detailed recipe from this content.` }
        ];

        let videoUrlText = "";
        finalMediaItems.forEach(item => {
            if (item.type === 'video') {
                videoUrlText += `\nVideo URL to analyze: ${item.url}`;
            } else {
                userContent.push({ type: "image_url", image_url: { url: item.url } });
            }
        });

        if (videoUrlText) userContent[0].text += videoUrlText;

        requestPayload = {
            model: "qwen/qwen3-vl-30b-a3b-instruct", 
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userContent }
            ],
            max_tokens: 2000,
            temperature: 0.2,
        };
    }



    // --- CACHE CHECK ---
    if (videoUrl) {
         const { data: cached } = await supabase
            .from('ai_recipe_cache')
            .select('recipe_json')
            .eq('source_url', videoUrl)
            .maybeSingle();

         if (cached) {
             console.log(`CACHE HIT for ${videoUrl}`);
             return new Response(JSON.stringify({ success: true, data: cached.recipe_json }), {
                headers: { 'Content-Type': 'application/json' }
             });
         }
         console.log(`CACHE MISS for ${videoUrl}`);
    }
    // -------------------

    console.log("Sending to AI...");

    // 5. Call Novita AI
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
        return new Response(JSON.stringify({ 
            success: false, 
            error: `AI Provider Error (${aiRes.status})`,
            details: errorText
        }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const aiJson = await aiRes.json();
    const content = aiJson.choices[0].message.content;

    // 6. Parse JSON
    let recipeData;
    try {
        console.log("Raw AI Content Length:", content.length);
        
        const firstOpen = content.indexOf('{');
        const lastClose = content.lastIndexOf('}');
        
        if (firstOpen !== -1 && lastClose !== -1 && lastClose > firstOpen) {
            const jsonStr = content.substring(firstOpen, lastClose + 1);
            recipeData = JSON.parse(jsonStr);
        } else {
             const cleanJson = content.replace(/```json/g, '').replace(/```/g, '').trim();
             recipeData = JSON.parse(cleanJson);
        }
        
        // Use the first media item as the thumbnail if not provided
        if (finalMediaItems.length > 0) {
             recipeData.imageUrl = finalMediaItems[0].url; 
        }
        // Source URL
        if(videoUrl) recipeData.sourceUrl = videoUrl;

    } catch (e) {
        console.error("JSON Parse Error. Content snippet:", content.substring(0, 100));
        throw new Error("Failed to parse recipe from AI response");
    }


    // --- CACHE SAVE ---
    if (videoUrl && recipeData) {
        // Run in background (don't await strictly to return faster)
        supabase.from('ai_recipe_cache')
            .insert({ source_url: videoUrl, recipe_json: recipeData })
            .select().single()
            .then(({ error }) => {
                if(error) console.error("Cache Insert Error:", error);
                else console.log("Cache Saved successfully");
            });
    }
    // ------------------

    return new Response(JSON.stringify({ success: true, data: recipeData }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error("Generate Recipe Function Error:", error);
    return new Response(JSON.stringify({ 
        success: false, 
        error: error.message,
      }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
})
