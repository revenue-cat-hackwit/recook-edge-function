import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'jsr:@supabase/supabase-js@2'

console.log("Pantry Recommendations function initialized")

interface PantryRecommendationRequest {
  pantryItems: string[]           
  maxIngredients?: number         
  cuisine?: string                
  difficulty?: 'easy' | 'medium' | 'hard'
  timeLimit?: number              
  servings?: number               
  userId?: string                 
  customPreferences?: {           
     foodAllergies?: string[];
     whatsInYourKitchen?: string[];
     favoriteCuisines?: string[];
     dietGoal?: string;
  }
}

interface RecipeRecommendation {
  title: string
  description: string
  time_minutes: number
  difficulty: 'Easy' | 'Medium' | 'Hard'
  servings: number
  calories_per_serving: number
  ingredients: {
    item: string
    quantity: number | string
    unit: string
  }[]
  tools: string[]
  steps: {
    step: number
    instruction: string
  }[]
  tips: string
  matchScore: number
  usedPantryItems: string[]
  missingIngredients: {
    item: string
    quantity: number | string
    unit: string
    isEssential: boolean
  }[]
  alternativeSuggestions?: string[]
}

Deno.serve(async (req) => {
  try {
    // 1. Authorization Check
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }), 
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!

    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } }
    })

    // 2. Parse Input
    const {
      pantryItems,
      maxIngredients = 5,
      cuisine = 'any',
      difficulty = 'easy',
      timeLimit = 60,
      servings = 2,
      customPreferences
    } = await req.json() as PantryRecommendationRequest

    // Validate Input
    if (!pantryItems || !Array.isArray(pantryItems) || pantryItems.length === 0) {
      return new Response(
        JSON.stringify({ error: 'pantryItems array is required and must not be empty' }), 
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    console.log(`Generating recommendations for ${pantryItems.length} pantry items: ${pantryItems.join(', ')}`)

    // 3. User Preferences Priority: Custom Params > DB (Backwards compat)
    let allergies: string[] = customPreferences?.foodAllergies || []
    let equipment: string[] = customPreferences?.whatsInYourKitchen || []
    let dietGoal: string = customPreferences?.dietGoal || ''
    
    // Always fetch user for usage logging and legacy fallback
    const { data: { user } } = await supabase.auth.getUser()

    // Only fetch from DB if customPreferences are missing (legacy fallback)
    if (!customPreferences && user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('allergies, equipment, diet_goal')
          .eq('id', user.id)
          .single()
        
        if (profile) {
          allergies = profile.allergies || []
          equipment = profile.equipment || []
          dietGoal = profile.diet_goal || ''
          console.log(`User profile loaded (Legacy DB). Allergies: ${allergies.join(', ') || 'none'}`)
        }
    } else {
        console.log(`User preferences loaded from Params (or empty). Allergies: ${allergies.join(', ')}`)
    }

    // 4. Prepare AI Request
    const novitaApiKey = Deno.env.get('NOVITA_AI_API_KEY')
    if (!novitaApiKey) {
      throw new Error('NOVITA_AI_API_KEY not configured')
    }

    const userCuisines = customPreferences?.favoriteCuisines?.join(', ') || "";

    // Build preferences prompt
    let prefsPrompt = ''
    if (allergies.length > 0) {
      prefsPrompt += `\nCRITICAL: User has ALLERGIES to: ${allergies.join(', ')}. NEVER include these ingredients.`
    }
    if (dietGoal) {
      prefsPrompt += `\nUser's diet goal: ${dietGoal}. Adjust recipe accordingly.`
    }
    if (equipment.length > 0) {
      prefsPrompt += `\nAvailable equipment: ${equipment.join(', ')}.`
    }
    if (userCuisines) {
        prefsPrompt += `\nFavorite Cuisines: ${userCuisines}.`
    }

    const systemPrompt = `You are "Recook Chef", an expert AI Chef specializing in pantry-based cooking.

Your task is to create 3 recipe recommendations based on the user's available pantry ingredients.

RULES:
1. PRIORITIZE using pantry ingredients FIRST - maximize the match score
2. Suggest recipes that use ${maxIngredients} or fewer main ingredients from the pantry
3. For missing ingredients, clearly mark if they are ESSENTIAL (dish fails without it) or OPTIONAL (can work around)
4. ${difficulty === 'easy' ? 'Keep instructions simple and straightforward for beginners.' : ''}
5. ${cuisine !== 'any' ? `Cuisine preference: ${cuisine}. Adapt recipes to this style.` : 'Create diverse cuisine options.'}
6. Maximum cooking time: ${timeLimit} minutes
7. Servings: ${servings}

${prefsPrompt}

OUTPUT: Return exactly 3 recipe recommendations in the specified JSON format. Each recipe must include matchScore (0-1), usedPantryItems, and missingIngredients with isEssential flag.`

    const userContent = `Generate 3 recipe recommendations using these pantry ingredients:
${pantryItems.join(', ')}

Preferences:
- Max main ingredients from pantry: ${maxIngredients}
- Cuisine: ${cuisine}
- Difficulty: ${difficulty}
- Time limit: ${timeLimit} minutes
- Servings: ${servings}

Create diverse recipes that best utilize the available ingredients. For ingredients not in the pantry, add them to missingIngredients and mark if essential.`

    // Define JSON Schema for structured output
    const recommendationSchema = {
      "type": "json_schema",
      "json_schema": {
        "name": "pantry_recommendations",
        "schema": {
          "type": "object",
          "properties": {
            "recommendations": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "title": { 
                    "type": "string",
                    "description": "Recipe name"
                  },
                  "description": { 
                    "type": "string",
                    "description": "Brief description of the dish"
                  },
                  "time_minutes": { 
                    "type": "number",
                    "description": "Total cooking time in minutes"
                  },
                  "difficulty": { 
                    "type": "string",
                    "enum": ["Easy", "Medium", "Hard"]
                  },
                  "servings": { 
                    "type": "number",
                    "description": "Number of servings"
                  },
                  "calories_per_serving": { 
                    "type": "number",
                    "description": "Estimated calories per serving"
                  },
                  "ingredients": {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "properties": {
                        "item": { "type": "string" },
                        "quantity": { 
                          "type": ["number", "string"],
                          "description": "Amount needed"
                        },
                        "unit": { 
                          "type": "string",
                          "description": "Unit of measurement (g, ml, cup, pcs, tbsp, etc.)"
                        }
                      },
                      "required": ["item", "quantity", "unit"]
                    }
                  },
                  "tools": {
                    "type": "array",
                    "items": { "type": "string" }
                  },
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
                  "tips": { 
                    "type": "string",
                    "description": "Cooking tips and serving suggestions"
                  },
                  "matchScore": { 
                    "type": "number",
                    "minimum": 0,
                    "maximum": 1,
                    "description": "Ratio of pantry ingredients used (0-1)"
                  },
                  "usedPantryItems": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "Which pantry items are used in this recipe"
                  },
                  "missingIngredients": {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "properties": {
                        "item": { "type": "string" },
                        "quantity": { "type": ["number", "string"] },
                        "unit": { "type": "string" },
                        "isEssential": { 
                          "type": "boolean",
                          "description": "True if dish cannot be made without this ingredient"
                        }
                      },
                      "required": ["item", "quantity", "unit", "isEssential"]
                    }
                  },
                  "alternativeSuggestions": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "Substitution tips for missing ingredients"
                  }
                },
                "required": [
                  "title", "description", "time_minutes", "difficulty", 
                  "servings", "calories_per_serving", "ingredients",
                  "tools", "steps", "tips", "matchScore", "usedPantryItems",
                  "missingIngredients"
                ]
              },
              "minItems": 3,
              "maxItems": 3
            }
          },
          "required": ["recommendations"]
        }
      }
    }

    const requestPayload = {
      model: "qwen/qwen3-vl-30b-a3b-instruct", 
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent }
      ],
      max_tokens: 3000,
      temperature: 0.3,
      response_format: recommendationSchema
    }

    console.log("Sending to AI for pantry recommendations...")

    // 5. Call Novita AI
    const aiRes = await fetch('https://api.novita.ai/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${novitaApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestPayload)
    })

    if (!aiRes.ok) {
      const errorText = await aiRes.text()
      console.error("AI API Error:", errorText)
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `AI Provider Error (${aiRes.status})`,
          details: errorText
        }), 
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const aiJson = await aiRes.json()
    const content = aiJson.choices[0].message.content

    // 6. Parse JSON Response
    let recommendationsData
    try {
      const firstOpen = content.indexOf('{')
      const lastClose = content.lastIndexOf('}')
      
      if (firstOpen !== -1 && lastClose !== -1 && lastClose > firstOpen) {
        const jsonStr = content.substring(firstOpen, lastClose + 1)
        recommendationsData = JSON.parse(jsonStr)
      } else {
        const cleanJson = content.replace(/```json/g, '').replace(/```/g, '').trim()
        recommendationsData = JSON.parse(cleanJson)
      }
      
      console.log(`Generated ${recommendationsData.recommendations?.length || 0} recommendations`)
      
    } catch (e) {
      console.error("JSON Parse Error. Content snippet:", content.substring(0, 200))
      throw new Error("Failed to parse AI response")
    }

    // 7. Validate and Enhance Response
    const recommendations: RecipeRecommendation[] = recommendationsData.recommendations || []
    
    // Add default image URLs and sanitize data
    const enhancedRecommendations = recommendations.map((rec, index) => ({
      ...rec,
      id: `pantry-rec-${Date.now()}-${index}`,
      imageUrl: `https://images.unsplash.com/photo-${[
        '1546069901-ba9599a7e63c', // salad
        '1563379926898-05f4575a45d8', // pasta
        '1603133872878-684f208fb84b', // rice
        '1540189549336-e6e99c3679fe'  // general food
      ][index % 4]}?w=800`,
      // Ensure all required fields exist
      matchScore: Math.min(Math.max(rec.matchScore || 0, 0), 1),
      alternativeSuggestions: rec.alternativeSuggestions || []
    }))

    // 8. Log Usage (fire-and-forget)
    if (user) {
      const totalTokens = aiJson.usage?.total_tokens || 0
      supabase.from('ai_usage_logs').insert({
        user_id: user.id,
        model: 'qwen/qwen3-vl-30b-a3b-instruct',
        task_type: 'pantry_recommendations',
        prompt_tokens: aiJson.usage?.prompt_tokens || 0,
        completion_tokens: aiJson.usage?.completion_tokens || 0,
        total_tokens: totalTokens
      }).then(({ error }) => {
        if (error) console.error("Usage log error:", error)
      })
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        data: enhancedRecommendations,
        meta: {
          pantryItemsUsed: pantryItems.length,
          generatedAt: new Date().toISOString(),
          preferences: { cuisine, difficulty, timeLimit, servings }
        }
      }), 
      { headers: { 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    console.error("Pantry Recommendations Error:", error)
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message,
        stack: Deno.env.get('DEV') ? error.stack : undefined
      }), 
      { 
        status: 500, 
        headers: { 'Content-Type': 'application/json' } 
      }
    )
  }
})

/* To invoke locally:

  1. Run `supabase start`
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/pantry-recommendations' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{
      "pantryItems": ["eggs", "rice", "soy sauce", "garlic", "oil"],
      "maxIngredients": 3,
      "difficulty": "easy",
      "timeLimit": 30,
      "servings": 2
    }'

*/
