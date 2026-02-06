import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'jsr:@supabase/supabase-js@2'

console.log("Generate Weekly Plan function initialized")

// Decode JWT manually
function decodeAndValidateJWT(token: string): { 
  valid: boolean; 
  userId?: string; 
  email?: string; 
  error?: string 
} {
  try {
    console.log('🔐 [JWT] Starting JWT decode...');
    
    // Split JWT into parts
    const parts = token.split('.');
    if (parts.length !== 3) {
      return { valid: false, error: 'Invalid token format' };
    }

    // Decode payload (base64url decode)
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    
    const payload = JSON.parse(jsonPayload);
    console.log('📦 [JWT] Payload decoded:', {
      userId: payload.userId,
      email: payload.email,
      exp: payload.exp
    });
    
    // Check expiration
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      console.error('❌ [JWT] Token expired');
      return { valid: false, error: 'Token expired' };
    }
    
    // Extract userId
    const userId = payload.userId;
    if (!userId) {
      return { valid: false, error: 'Missing userId in token' };
    }
    
    console.log('✅ [JWT] JWT validation successful!');
    
    return { 
      valid: true, 
      userId: userId,
      email: payload.email
    };
  } catch (error) {
    console.error('❌ [JWT] Decode error:', error);
    return { valid: false, error: String(error) };
  }
}

Deno.serve(async (req) => {
  try {
    // 0. Handle CORS (Optional but good practice if called from browser directly, though usually handled by Supabase)
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: { 
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      } })
    }

    // 1. Get custom JWT from Authorization header
    // 1. Get custom JWT from X-Custom-Auth header
    const token = req.headers.get('X-Custom-Auth');
    
    if (!token) {
      return new Response(JSON.stringify({ 
        error: 'Missing X-Custom-Auth header' 
      }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    // const token = authHeader.replace('Bearer ', ''); // No longer needed
    const validation = decodeAndValidateJWT(token);
    
    if (!validation.valid) {
      return new Response(JSON.stringify({ 
        error: validation.error 
      }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    const customUserId = validation.userId; // This is the MongoDB ID
    
    // 2. Initialize Supabase with Service Role Key (Bypass RLS)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    // Important: Do not pass the custom JWT to Supabase client
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // EXTRACT PREFERENCES FROM REQUEST BODY (Since we removed them from DB)
    const { startDate, generationMode, customPreferences } = await req.json()
    if (!startDate) {
        return new Response(JSON.stringify({ error: 'startDate is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }

    const novitaApiKey = Deno.env.get('NOVITA_AI_API_KEY')
    if (!novitaApiKey) throw new Error('NOVITA_AI_API_KEY not configured');

    // 3. Resolve Custom User ID to Supabase User Profile
    // We attempt to find the user by custom_user_id. If not found, we try to sync via email.
    let supabaseUserId: string | null = null;
    
    // Attempt 1: Direct Lookup
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('custom_user_id', customUserId)
      .maybeSingle(); // Use maybeSingle to avoid error on null

    if (profile) {
        supabaseUserId = profile.id;
    } else {
        console.log(`⚠️ Profile missing for customID: ${customUserId}. Attempting auto-sync...`);
        
        const userEmail = validation.email;
        if (!userEmail) {
             console.error("❌ No email in JWT, cannot sync.");
             return new Response(JSON.stringify({ error: 'User profile not found and no email in token.' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
        }

        // Attempt 2: Find existing Profile by Email (maybe they logged in before but didn't have custom_id link)
        let existingProfileId: string | null = null;
        
        const { data: existingProfileByEmail } = await supabase
            .from('profiles')
            .select('id')
            .eq('email', userEmail)
            .maybeSingle();
            
        if (existingProfileByEmail) {
             existingProfileId = existingProfileByEmail.id;
        } else {
             console.log(`Creating new Supabase user for ${userEmail}...`);
             // Create new Auth User
             const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
                email: userEmail,
                email_confirm: true,
                user_metadata: { full_name: "App User" }
             });
             
             if (createError) {
                 // If "User already registered" but no profile found, it's a data consistency issue or race condition
                 if (createError.message?.toLowerCase().includes("already registered")) {
                      console.warn("User already registered in Auth but profile missing completely? Attempting recovery...");
                      // We can't get the ID easily if listUsers is not efficient, but let's assume we can't proceed without admin search
                      // For now, return error asking to contact support or try again
                      return new Response(JSON.stringify({ error: `User sync failed: Email ${userEmail} already registered but profile missing.` }), { status: 500, headers: { 'Content-Type': 'application/json' } });
                 }
                 
                 console.error("Create User Error:", createError);
                 return new Response(JSON.stringify({ error: `Failed to create user: ${createError.message}` }), { status: 500, headers: { 'Content-Type': 'application/json' } });
             }
             
             if (newUser.user) {
                 existingProfileId = newUser.user.id;
                 // Wait a moment for trigger to create profile
                 await new Promise(r => setTimeout(r, 500));
             }
        }

        if (existingProfileId) {
             console.log(`✅ Linking Custom ID ${customUserId} to Supabase ID ${existingProfileId}`);
             const { error: updateError } = await supabase
                .from('profiles')
                .update({ custom_user_id: customUserId })
                .eq('id', existingProfileId);
                
             if (updateError) {
                 console.error("Link Error:", updateError);
             } else {
                 supabaseUserId = existingProfileId;
             }
        }
    }

    if (!supabaseUserId) {
        return new Response(JSON.stringify({ error: 'User profile not found. Please relogin to sync account.' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }

    // 3.5. VERIFY SUBSCRIPTION (Backend Enforcement)
    let isPro = false;
    
    // Check for active subscription in DB
    const { data: sub } = await supabase
        .from('user_subscriptions')
        .select('status, expires_at')
        .eq('user_id', supabaseUserId)
        .eq('status', 'active')
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();
        
    if (sub) {
        isPro = true;
        console.log(`✅ User ${supabaseUserId} is PRO`);
    } else {
        console.log(`ℹ️ User ${supabaseUserId} is FREE`);
    }

    // Enforce Free Limits (e.g., 3 per day)
    const FREE_DAILY_LIMIT = 3;
    
    if (!isPro) {
        const todayStart = new Date();
        todayStart.setHours(0,0,0,0);
        
        const { count, error: countError } = await supabase
            .from('ai_usage_logs')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', supabaseUserId)
            .gte('created_at', todayStart.toISOString());
            
        if (countError) {
            console.error("Usage Check Error:", countError);
            // Fail open or closed? Let's fail open for now but log it.
        } else if ((count || 0) >= FREE_DAILY_LIMIT) {
             console.warn(`⛔ User ${supabaseUserId} reached free limit (${count}/${FREE_DAILY_LIMIT})`);
             return new Response(JSON.stringify({ 
                 error: 'Free limit reached. Please upgrade to Pro for unlimited meal plans.',
                 code: 'LIMIT_REACHED'
             }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }
    }

    // 4. Get Pantry
    const { data: pantry } = await supabase
        .from('pantry_items')
        .select('ingredient_name')
        .eq('user_id', supabaseUserId);
    
    // Extract preferences from request (Source: MongoDB via App)
    const diet = customPreferences?.goal || customPreferences?.dietType || "General Healthy";
    const allergies = customPreferences?.allergies || customPreferences?.foodAllergies?.join(', ') || "None"; // Handle both old and new format
    const calories = customPreferences?.calories || "Not specified";
    const userCuisines = customPreferences?.favoriteCuisines?.join(', ') || "";
    const userTools = customPreferences?.whatsInYourKitchen?.join(', ') || "";

    const pantryList = pantry && pantry.length > 0 ? pantry.map((p: { ingredient_name: string }) => p.ingredient_name).join(', ') : "None";

    let finalPromptConstraints = `Diet: ${diet}\nAllergies: ${allergies}\nCalories per day: ${calories}`;
    if (userCuisines) finalPromptConstraints += `\nPreferred Cuisines: ${userCuisines}`;
    if (userTools) finalPromptConstraints += `\nAvailable Tools: ${userTools}`;
    if (pantryList !== "None") finalPromptConstraints += `\nPantry Items: ${pantryList}`;

    console.log(`Generating plan for ${diet}, Allergies: ${allergies}, Calories: ${calories}, Pantry: ${pantryList}, Mode: ${generationMode || 'replace'}`);

    // 5. If mode is 'fill', get existing meal plans to skip those slots
    const existingSlots = new Set<string>();
    if (generationMode === 'fill') {
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + 6);
        const endDateStr = endDate.toISOString().split('T')[0];
        
        const { data: existing } = await supabase
            .from('meal_plans')
            .select('date, meal_type')
            .eq('user_id', supabaseUserId)
            .gte('date', startDate)
            .lte('date', endDateStr);
        
        if (existing) {
            existing.forEach((slot: { date: string; meal_type: string }) => {
                existingSlots.add(`${slot.date}_${slot.meal_type}`);
            });
        }
        console.log(`Fill mode: Found ${existingSlots.size} existing slots to skip`);
    }

    // 6. Define JSON Schema for Structured Output
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
                                "recipe_name": { 
                                    "type": "string",
                                    "description": "Name of the dish only. No day, date, or parenthetical descriptions."
                                },
                                "description": { 
                                    "type": "string", 
                                    "description": "Short description of the meal including dietary info if relevant." 
                                }
                            },
                            "required": ["recipe_name", "description"]
                        }
                    }
                },
                "required": ["plan"]
            }
        }
    };

    // 7. Prompt Llama 3
    const prompt = `
    You are an expert Meal Planner.
    Create a 7-day Meal Plan (Breakfast, Lunch, Dinner) starting from ${startDate}.
    
    User Profile:
    ${finalPromptConstraints}

    OUTPUT REQUIREMENT:
    - You MUST return a JSON object with a single key "plan" containing an array of exactly 21 items (7 days * 3 meals).
    - The order MUST be: Day 1 Breakfast, Day 1 Lunch, Day 1 Dinner, Day 2 Breakfast, etc.
    
    STRICT FORMATTING RULES FOR 'recipe_name':
    - MUST contain ONLY the name of the dish (e.g., "Chicken Caesar Salad", "Oatmeal with Berries").
    - DO NOT include the day (e.g., "Day 1").
    - DO NOT include the meal type (e.g., "Dinner").
    - DO NOT include parentheses with descriptions (e.g., "(Healthy Option)", "(Gluten Free)").
    - DO NOT include the date.
    - Put all dietary context, calorie counts, or explanations in the 'description' field, NOT the 'recipe_name'.
    - Keep 'recipe_name' concise and clean.
    `;

    // 8. Call AI with Fallback Mechanism
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
                model: "meta-llama/llama-3-70b-instruct", 
                messages: [
                    { role: "system", content: "You are a meal planning API. Output strictly structured JSON. recipe_name must be clean." },
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
                model: "meta-llama/llama-3-70b-instruct", 
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

    // 9. Parse JSON
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

    // 10. Process & Insert (Deterministic Loop)
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
        // SANITIZE RECIPE NAME
        // AI sometimes puts the description or nutrition info in the title effectively ignoring instructions
        let cleanTitle = item.recipe_name;
        let cleanDescription = item.description || '';

        // 1. Split by " - " or ": " if present (e.g. "Title - Description")
        // But be careful not to split "Coq au Vin" or valid titles. Usually descriptions are long.
        if (cleanTitle.length > 40 && (cleanTitle.includes(' - ') || cleanTitle.includes(': '))) {
            const separatorRegex = / - |: /;
            const parts = cleanTitle.split(separatorRegex);
            if (parts.length > 1) {
                // Heuristic: First part is title, rest is description
                cleanTitle = parts[0].trim();
                const remainder = parts.slice(1).join(' - ').trim();
                cleanDescription = `${remainder}. ${cleanDescription}`.trim();
            }
        }

        // 2. Remove parenthetical nutritional info (e.g. "(500 kcal)")
        if (cleanTitle.includes('(')) {
             const parenIdx = cleanTitle.indexOf('(');
             // Verify it looks like extra info (end of string)
             const extraInfo = cleanTitle.substring(parenIdx);
             cleanTitle = cleanTitle.substring(0, parenIdx).trim();
             cleanDescription = `${extraInfo} ${cleanDescription}`.trim();
        }

        // 3. Remove "Recipe" from end if present (e.g. "Chicken Salad Recipe")
        if (cleanTitle.toLowerCase().endsWith(' recipe')) {
            cleanTitle = cleanTitle.slice(0, -7).trim();
        }

        // 4. Hard cap on length just in case
        if (cleanTitle.length > 60) {
            cleanDescription = `${cleanTitle}... ${cleanDescription}`.trim();
            cleanTitle = cleanTitle.substring(0, 57) + "...";
        }

        // NEW LOGIC: DIRECTLY INSERT IDEA INTO MEAL_PLANS (No Recipe Creation)
        // We skip creating a 'user_recipes' entry to keep the recipe collection clean.
        
        const mealPlanPayload = {
            user_id: supabaseUserId,
            custom_user_id: customUserId,
            date: dateStr,
            meal_type: mealType,
            recipe_id: null, // Explicitly NULL: it's just an idea
            idea_title: cleanTitle,
            idea_description: cleanDescription
        };

        if (generationMode === 'fill') {
             // Fill mode: only insert if slot doesn't exist (already checked above)
             const { error } = await supabase.from('meal_plans').insert(mealPlanPayload);
             
             if (error) {
                 console.error(`Failed to insert plan for ${dateStr} ${mealType}:`, error);
             } else {
                 results.push({ date: dateStr, meal: mealType, recipe: cleanTitle });
             }
        } else {
             // Replace mode: upsert to replace existing
             const { error } = await supabase.from('meal_plans').upsert(mealPlanPayload, { 
                onConflict: 'user_id, date, meal_type' 
             });
             
             if (error) {
                 console.error(`Failed to upsert plan for ${dateStr} ${mealType}:`, error);
             } else {
                 results.push({ date: dateStr, meal: mealType, recipe: cleanTitle });
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
