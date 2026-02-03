import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'jsr:@supabase/supabase-js@2'

console.log("Generate Weekly Plan function initialized")

Deno.serve(async (req) => {
  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), { status: 401 })
    }

    const { startDate, generationMode } = await req.json()
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
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("User not found");

    const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single();
    const { data: pantry } = await supabase.from('pantry_items').select('ingredient_name').eq('user_id', user.id);

    const diet = profile?.diet_goal || "General Healthy";
    const allergies = profile?.allergies && profile.allergies.length > 0 ? profile.allergies.join(', ') : "None";
    const pantryList = pantry && pantry.length > 0 ? pantry.map((p: { ingredient_name: string }) => p.ingredient_name).join(', ') : "None";

    console.log(`Generating plan for ${diet}, Allergies: ${allergies}, Pantry: ${pantryList}, Mode: ${generationMode || 'replace'}`);

    // 1.5. If mode is 'fill', get existing meal plans to skip those slots
    const existingSlots = new Set<string>();
    if (generationMode === 'fill') {
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + 6);
        const endDateStr = endDate.toISOString().split('T')[0];
        
        const { data: existing } = await supabase
            .from('meal_plans')
            .select('date, meal_type')
            .eq('user_id', user.id)
            .gte('date', startDate)
            .lte('date', endDateStr);
        
        if (existing) {
            existing.forEach((slot: { date: string; meal_type: string }) => {
                existingSlots.add(`${slot.date}_${slot.meal_type}`);
            });
        }
        console.log(`Fill mode: Found ${existingSlots.size} existing slots to skip`);
    }

    // 2. Define JSON Schema for Structured Output
    const responseFormat = {
        "type": "json_schema",
        "json_schema": {
            "name": "meal_plan_response",
            "schema": {
                "type": "object",
                "properties": {
                    "plan": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "recipe_name": { "type": "string" },
                                "description": { "type": "string" }
                            },
                            "required": ["recipe_name", "description"]
                        }
                    }
                },
                "required": ["plan"]
            }
        }
    };

    // 3. Prompt Llama 3
    const prompt = `
    You are an expert Meal Planner.
    Create a 7-day Meal Plan (Breakfast, Lunch, Dinner) starting from ${startDate}.
    
    User Profile:
    - Diet Goal: ${diet}
    - Allergies: ${allergies}
    - Pantry Items: ${pantryList}

    OUTPUT REQUIREMENT:
    - You MUST return a JSON object with a single key "plan" containing an array of exactly 21 items (7 days * 3 meals).
    - The order MUST be: Day 1 Breakfast, Day 1 Lunch, Day 1 Dinner, Day 2 Breakfast, etc.
    `;

    // 4. Call AI with Fallback Mechanism
    const apiUrl = 'https://api.novita.ai/openai/v1/chat/completions';
    const headers = {
        'Authorization': `Bearer ${novitaApiKey}`,
        'Content-Type': 'application/json',
    };

    let content = "";

    try {
        // ATTEMPT 1: Structured Output
        console.log("Attempt 1: Structured Output");
        const res1 = await fetch(apiUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                model: "meta-llama/llama-3.1-70b-instruct", 
                messages: [
                    { role: "system", content: "You are a meal planning API that outputs structured JSON." },
                    { role: "user", content: prompt }
                ],
                temperature: 0.3,
                max_tokens: 3000,
                response_format: responseFormat
            })
        });

        if (res1.ok) {
            const json1 = await res1.json();
            content = json1.choices[0].message.content;
        } else {
            console.warn("Structured Output rejected, trying fallback...", await res1.text());
            throw new Error("Fallback");
        }
    } catch (_err) {
        // ATTEMPT 2: Fallback to Raw Prompt Engineering
        console.log("Attempt 2: Raw Prompt Fallback");
        const res2 = await fetch(apiUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                model: "meta-llama/llama-3.1-70b-instruct",
                messages: [
                    { role: "system", content: "You MUST output strictly valid JSON array only. No intro text." },
                    { role: "user", content: prompt + "\n\nRETURN JSON ARRAY ONLY." }
                ],
                temperature: 0.3,
                max_tokens: 3000,
                response_format: { type: "json_object" } // Simple JSON mode usually supported
            })
        });

        if (!res2.ok) {
            const errText = await res2.text();
            throw new Error(`AI API Failed: ${errText}`);
        }
        
        const json2 = await res2.json();
        content = json2.choices[0].message.content;
    }

    // 5. Parse JSON
    let plan = [];
    try {
        // Try parsing directly first
        const parsed = JSON.parse(content);
        
        if (parsed.plan && Array.isArray(parsed.plan)) {
            plan = parsed.plan;
        } else if (Array.isArray(parsed)) {
            plan = parsed;
        } else if (parsed && typeof parsed === 'object') {
             // Sometimes "json_object" returns { "something": [array] } random keys
             const values = Object.values(parsed);
             const foundArray = values.find(v => Array.isArray(v));
             if (foundArray) plan = foundArray as any[];
             else plan = parsed as any; // Desperate fallback
        }
    } catch (e: unknown) {
        console.error("JSON Parse Error. Content:", content);
        // Retry clean up regex if direct parse fails
        try {
             const clean = content.replace(/```json/g, '').replace(/```/g, '').trim();
             const first = clean.indexOf('[');
             const last = clean.lastIndexOf(']');
             if (first !== -1 && last !== -1) {
                plan = JSON.parse(clean.substring(first, last + 1));
             }
        } catch (_e2) {
             const msg = e instanceof Error ? e.message : 'Unknown error';
             throw new Error(`Failed to parse meal plan: ${msg}`);
        }
    }

    if (plan.length < 21) {
         console.warn(`AI returned ${plan.length} items instead of 21`);
    }

    // 6. Process & Insert (Deterministic Loop)
    const results = [];
    const mealTypes = ['breakfast', 'lunch', 'dinner'];
    let dayIndex = 0;
    
    // We expect 3 meals per day.
    for (let i = 0; i < plan.length; i++) {
        const item = plan[i];
        
        // Calculate Day Offset & Meal Type based on Index
        dayIndex = Math.floor(i / 3);
        const mealType = mealTypes[i % 3];

        if (dayIndex > 6) break; // Limit to 7 days

        // Calculate date
        const dateObj = new Date(startDate);
        dateObj.setDate(dateObj.getDate() + dayIndex);
        const dateStr = dateObj.toISOString().split('T')[0];

        // Check if this slot should be skipped (fill mode only)
        const slotKey = `${dateStr}_${mealType}`;
        if (generationMode === 'fill' && existingSlots.has(slotKey)) {
            console.log(`Skipping existing slot: ${slotKey}`);
            continue;
        }

        // Find or Create Recipe
        let recipeId;
        
        // Search existing
        const { data: existing } = await supabase.from('user_recipes')
            .select('id')
            .eq('user_id', user.id)
            .ilike('title', item.recipe_name)
            .maybeSingle();

        if (existing) {
            recipeId = existing.id;
        } else {
            // Create New Skeleton Recipe
            const { data: newRecipe } = await supabase.from('user_recipes').insert({
                user_id: user.id,
                title: item.recipe_name,
                description: item.description,
                ingredients: [], 
                steps: [],
                time_minutes: "30",
                difficulty: "Medium",
                servings: "2",
                calories_per_serving: "Unknown",
                image_url: null 
            }).select('id').single();
            
            if (newRecipe) recipeId = newRecipe.id;
        }

        if (recipeId) {
            // Insert Meal Plan - use upsert for replace mode, insert for fill mode
            if (generationMode === 'fill') {
                // Fill mode: only insert if slot doesn't exist (already checked above)
                const { error } = await supabase.from('meal_plans').insert({
                    user_id: user.id,
                    date: dateStr,
                    meal_type: mealType,
                    recipe_id: recipeId
                });
                if (!error) results.push({ date: dateStr, meal: mealType, recipe: item.recipe_name });
            } else {
                // Replace mode: upsert to replace existing
                const { error } = await supabase.from('meal_plans').upsert({
                    user_id: user.id,
                    date: dateStr,
                    meal_type: mealType,
                    recipe_id: recipeId
                }, { onConflict: 'user_id, date, meal_type' }); 

                if (!error) results.push({ date: dateStr, meal: mealType, recipe: item.recipe_name });
            }
        }
    }

    return new Response(JSON.stringify({ success: true, count: results.length, data: results }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Generate Weekly Plan Error:", error);
    return new Response(JSON.stringify({ 
        success: false, 
        error: errorMessage 
      }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
})
