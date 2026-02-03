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
    const { mediaItems, userPreferences, videoUrl } = await req.json() as RecipeRequest

    // Validate Input
    let finalMediaItems = mediaItems;
    if (!finalMediaItems || finalMediaItems.length === 0) {
        if (videoUrl) {
            // Fallback: If user sent just a URL, treat it as a direct video link (assuming it was already processed or is direct)
            finalMediaItems = [{ type: 'video', url: videoUrl }];
        } else {
            return new Response(JSON.stringify({ error: 'mediaItems or videoUrl is required' }), { status: 400 })
        }
    }

    console.log(`Processing recipe generation for ${finalMediaItems.length} items`);

    // 3. Prepare AI Request for Novita AI
    const novitaApiKey = Deno.env.get('NOVITA_AI_API_KEY')
    if (!novitaApiKey) throw new Error('NOVITA_AI_API_KEY not configured');

    // 4. Fetch User Context from DB (Source of Truth)
    let dbPreferences: any = {};
    let dbPantry: any[] = [];

    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
        // Fetch Profile
        const { data: profile } = await supabase.from('profiles').select('allergies, diet_goal, equipment').eq('id', user.id).single();
        if (profile) dbPreferences = profile;

        // Fetch Pantry (Optional: Use ingredients from pantry)
        const { data: pantry } = await supabase.from('pantry_items').select('ingredient_name').eq('user_id', user.id);
        if (pantry) dbPantry = pantry; 
    }

    // Merge: DB takes precedence over client-side if available
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

    const systemPrompt = `You are "Recook Chef", an expert AI Chef. 
Your task is to analyze the provided media (video or images) and generate a precise cooking recipe.

CRITICAL VALIDATION:
1. First, check if the content shows FOOD, COOKING, or INGREDIENTS.
2. If the content does NOT contain food/cooking (e.g., people, landscapes, objects, animals, etc.), you MUST respond with ONLY this exact JSON:
   {"error": "no_food_detected", "message": "This image/video does not appear to contain food or cooking content."}
3. If content IS food-related, proceed with recipe generation.

${prefsPrompt}

OUTPUT JSON format exactly as requested:
{
  "title": "", "description": "", "time_minutes": 0, "difficulty": "", 
  "servings": 0, "calories_per_serving": 0, 
  "ingredients": [], "tools": [], "steps": [{"step": 1, "instruction": ""}], "tips": ""
}`;

    // Construct Multi-Modal User Content
    const userContent: any[] = [
        { type: "text", text: `Create a detailed recipe from this content.` }
    ];

    finalMediaItems.forEach(item => {
        if (item.type === 'video') {
            userContent.push({ type: "video_url", video_url: { url: item.url } });
        } else {
            userContent.push({ type: "image_url", image_url: { url: item.url } });
        }
    });

    // 3. Define JSON Schema for Recipe
    const recipeSchema = {
      "type": "json_schema",
      "json_schema": {
        "name": "recipe_response",
        "schema": {
          "type": "object",
          "properties": {
            "title": { "type": "string" },
            "description": { "type": "string" },
            "time_minutes": { "type": "number", "description": "Total cooking time in minutes (number only)" },
            "difficulty": { "type": "string", "enum": ["Easy", "Medium", "Hard"] },
            "servings": { "type": "number" },
            "calories_per_serving": { "type": "number", "description": "Calories count used number only, no text like kcal" },
            "ingredients": { 
              "type": "array", 
              "items": { 
                "type": "object",
                "properties": {
                  "item": { "type": "string", "description": "Ingredient name, e.g. 'Chicken breast'" },
                  "quantity": { "type": ["number", "string"], "description": "Amount needed, e.g. 200 or '1/2'" },
                  "unit": { "type": "string", "description": "Unit of measurement, e.g. 'g', 'ml', 'cup', 'pcs', 'tbsp'" }
                },
                "required": ["item", "quantity", "unit"]
              },
              "description": "List of ingredients as structured objects with item name, quantity, and unit"
            },
            "tools": { "type": "array", "items": { "type": "string" } },
            "steps": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "step": { "type": "number" },
                  "instruction": { "type": "string" }
                },
                "required": ["step", "instruction"]
              }
            },
            "tips": { "type": "string" }
          },
          "required": ["title", "description", "ingredients", "steps", "time_minutes", "servings", "calories_per_serving", "difficulty"]
        }
      }
    };

    const requestPayload = {
      model: "qwen/qwen3-vl-30b-a3b-instruct", 
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent }
      ],
      max_tokens: 2000,
      temperature: 0.2,
      response_format: recipeSchema
    };


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

        // Check if AI detected non-food content
        if (recipeData.error === 'no_food_detected') {
            return new Response(JSON.stringify({ 
                success: false, 
                error: 'No food content detected',
                message: recipeData.message || 'The provided image/video does not appear to contain food or cooking content. Please upload a food-related image or video.'
            }), { 
                status: 400, 
                headers: { 'Content-Type': 'application/json' } 
            });
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
