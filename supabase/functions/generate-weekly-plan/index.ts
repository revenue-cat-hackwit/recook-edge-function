import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'jsr:@supabase/supabase-js@2'

console.log("Generate Weekly Plan function initialized")

Deno.serve(async (req) => {
  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), { status: 401 })
    }

    const { startDate } = await req.json()
    if (!startDate) {
        return new Response(JSON.stringify({ error: 'startDate is required' }), { status: 400 })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } }
    })

    const novitaApiKey = Deno.env.get('NOVITA_AI_API_KEY')
    if (!novitaApiKey) throw new Error('NOVITA_AI_API_KEY not configured');

    // 1. Get User Profile & Pantry
    const debugMode = req.headers.get('x-debug-mode') === 'true';
    console.log("Debug Mode:", debugMode, "Auth Header Present:", !!authHeader);

    let user;

    if (debugMode) {
        console.log("DEBUG MODE ENABLED: Using mock user");
        user = { id: '00000000-0000-0000-0000-000000000000' };
    } else {
        try {
            const { data, error: authError } = await supabase.auth.getUser();
            if (authError) throw authError;
            user = data.user;
            if (!user) throw new Error("User not found (Auth returned no user)");
        } catch (e: any) {
            console.error("Auth Error:", e);
            throw new Error(`Authentication failed: ${e.message}`);
        }
    }

    const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
    const { data: pantry } = await supabase.from('pantry_items').select('ingredient_name').eq('user_id', user.id);

    const diet = profile?.diet_goal || "General Healthy";
    const allergies = profile?.allergies && profile.allergies.length > 0 ? profile.allergies.join(', ') : "None";
    const pantryList = pantry && pantry.length > 0 ? pantry.map((p: any) => p.ingredient_name).join(', ') : "None";

    console.log(`Generating plan for User ${user.id} (${diet}), Allergies: ${allergies}, Pantry: ${pantryList}`);

    // 3. Define JSON schema & Prompt
    const prompt = `Generate a weekly meal plan (21 meals) for a user with:
    - Diet: ${diet}
    - Allergies: ${allergies}
    - Pantry Items available: ${pantryList}
    
    Ensure variety and nutrition. Use the pantry items if possible.`;

    // 4. Call AI (Simplified & Robust Mode)
    const apiUrl = 'https://api.novita.ai/openai/v1/chat/completions';
    const headers = {
        'Authorization': `Bearer ${novitaApiKey}`,
        'Content-Type': 'application/json',
    };

    const simplifiedSystemPrompt = `You are an expert Meal Planner.
Output a JSON object with this exact structure:
{
  "plan": [
    {
      "recipe_name": "Name of dish",
      "description": "Short description"
    }
  ]
}
Create 21 items (7 days * 3 meals).
Do not include any markdown formatting (backticks). Just raw JSON.`;

    console.log("Sending Request to AI...");
    
    // Single Robust Attempt
    const aiRes = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            model: "meta-llama/llama-3-70b-instruct", 
            messages: [
                { role: "system", content: simplifiedSystemPrompt },
                { role: "user", content: prompt }
            ],
            temperature: 0.4,
            max_tokens: 3500,
            response_format: { type: "json_object" }
        })
    });

    if (!aiRes.ok) {
        const errText = await aiRes.text();
        console.error("AI Provider Error:", errText);
        throw new Error(`AI Provider Error (${aiRes.status}): ${errText}`);
    }

    const aiJson = await aiRes.json();
    let content = aiJson.choices[0].message.content;

    // Clean up potential markdown
    content = content.replace(/```json/g, '').replace(/```/g, '').trim();
    let plan = [];
    try {
        const parsed = JSON.parse(content);
        if (parsed.plan && Array.isArray(parsed.plan)) {
            plan = parsed.plan;
        } else if (Array.isArray(parsed)) {
            plan = parsed;
        } else if (parsed && typeof parsed === 'object') {
             const values = Object.values(parsed);
             const foundArray = values.find(v => Array.isArray(v));
             if (foundArray) plan = foundArray as any[];
             else plan = parsed as any; 
        }
    } catch (e: unknown) {
        console.error("JSON Parse Error. Content:", content);
        // Desperate fallback regex
        try {
             const clean = content.replace(/```json/g, '').replace(/```/g, '').trim();
             const first = clean.indexOf('[');
             const last = clean.lastIndexOf(']');
             if (first !== -1 && last !== -1) {
                plan = JSON.parse(clean.substring(first, last + 1));
             }
        } catch (e2) {
             const msg = e instanceof Error ? e.message : 'Unknown error';
             throw new Error(`Failed to parse meal plan: ${msg}`);
        }
    }

    if (plan.length < 21) {
         console.warn(`AI returned ${plan.length} items instead of 21`);
    }

    if (debugMode) {
        return new Response(JSON.stringify({ success: true, count: plan.length, data: plan, debug: true }), {
             headers: { 'Content-Type': 'application/json' }
        });
    }

    // 6. Process & Insert (Optimized for Speed)
    const mealTypes = ['breakfast', 'lunch', 'dinner'];
    const mealPlanPayloads: any[] = [];
    
    // Step A: Prepare helpers
    const getRecipeId = async (name: string, desc: string): Promise<string | null> => {
        // Check existing
        const { data: existing } = await supabase.from('user_recipes')
            .select('id')
            .eq('user_id', user.id)
            .ilike('title', name)
            .maybeSingle();
            
        if (existing) return existing.id;
        
        // Create New
        const { data: newRecipe, error } = await supabase.from('user_recipes').insert({
            user_id: user.id,
            title: name,
            description: desc,
            ingredients: [], 
            steps: [],
            time_minutes: "30",
            difficulty: "Medium",
            servings: "2",
            calories_per_serving: "Unknown",
            image_url: null 
        }).select('id').single();
        
        if (error) {
            console.error("Failed to create recipe:", name, error);
            return null;
        }
        return newRecipe.id;
    };

    // Step B: Process all items in parallel (limit concurrency if needed, but 21 is fine)
    const planPromises = plan.map(async (item: any, index: number) => {
        if (index > 20) return; // Cap at 21

        const dayIndex = Math.floor(index / 3);
        const mealType = mealTypes[index % 3];

        const dateObj = new Date(startDate);
        dateObj.setDate(dateObj.getDate() + dayIndex);
        const dateStr = dateObj.toISOString().split('T')[0];

        const recipeId = await getRecipeId(item.recipe_name, item.description);
        
        if (recipeId) {
            mealPlanPayloads.push({
                user_id: user.id,
                date: dateStr,
                meal_type: mealType,
                recipe_id: recipeId
            });
            return { date: dateStr, meal: mealType, recipe: item.recipe_name };
        }
        return null;
    });

    const results = (await Promise.all(planPromises)).filter(Boolean);

    // Step C: Batch Upsert Plans
    if (mealPlanPayloads.length > 0) {
        const { error: upsertError } = await supabase.from('meal_plans').upsert(
            mealPlanPayloads, 
            { onConflict: 'user_id, date, meal_type' }
        );
        if (upsertError) console.error("Batch Upsert Error:", upsertError);
    }

    return new Response(JSON.stringify({ success: true, count: results.length, data: results }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error("Generate Weekly Plan Error:", error);
    // Explicit 'message' property for supabase-js to pick up
    return new Response(JSON.stringify({ 
        success: false, 
        error: error.message,
        message: error.message 
      }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
})
