import "jsr:@supabase/functions-js/edge-runtime.d.ts"

console.log("Analyze Nutrition function initialized")

const NOVITA_API_KEY = Deno.env.get('NOVITA_AI_API_KEY');

interface NutritionInfo {
  foodName: string
  servingSize: string
  calories: number
  protein: number
  carbs: number
  fat: number
  fiber: number
  sugar: number
  sodium: number
  confidence: number
  healthScore: number
  dietaryFlags: string[]
  warnings?: string[]
}

Deno.serve(async (req) => {
  try {
    if (!NOVITA_API_KEY) {
      return new Response(
        JSON.stringify({ success: false, error: 'Server Config Error' }), 
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const { imageUrl } = await req.json();
    if (!imageUrl) {
      return new Response(
        JSON.stringify({ success: false, error: 'imageUrl is required' }), 
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const systemPrompt = `You are a Nutrition Analysis AI Expert.

Analyze the food image and provide detailed nutritional information.

CRITICAL VALIDATION:
1. First, verify the image contains FOOD or a MEAL
2. If the image does NOT contain food (e.g., people, objects, landscapes), respond with an error
3. If food IS present, provide comprehensive nutrition analysis

RULES:
- Identify the food/dish name
- Estimate serving size based on visual cues
- Calculate nutritional values per serving
- Assign a health score (0-100) based on overall nutritional quality
- List dietary flags (e.g., "High Protein", "Low Carb", "Vegan", "Gluten-Free")
- Include warnings for allergens or health concerns

OUTPUT: Return ONLY valid JSON matching this exact structure:
{
  "foodName": "Name of the dish/food",
  "servingSize": "Estimated serving size (e.g., '1 plate', '250g')",
  "calories": number (total calories),
  "protein": number (grams),
  "carbs": number (grams),
  "fat": number (grams),
  "fiber": number (grams),
  "sugar": number (grams),
  "sodium": number (mg),
  "confidence": number (0-1, how confident you are in the analysis),
  "healthScore": number (0-100, overall health rating),
  "dietaryFlags": ["flag1", "flag2"],
  "warnings": ["warning1"] (optional, if any allergens or concerns)
}`;

    const requestPayload = {
      model: "qwen/qwen3-vl-30b-a3b-instruct",
      messages: [
        { role: "system", content: systemPrompt },
        { 
          role: "user", 
          content: [
            { type: "text", text: "Analyze the nutritional content of this food and provide detailed nutrition facts as JSON." },
            { type: "image_url", image_url: { url: imageUrl } }
          ]
        }
      ],
      max_tokens: 1500,
      temperature: 0.2
    };

    console.log("Sending to AI for nutrition analysis...");

    const aiRes = await fetch('https://api.novita.ai/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOVITA_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestPayload)
    });

    if (!aiRes.ok) {
      const errorText = await aiRes.text();
      console.error("AI API Error:", errorText);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `AI Provider Error (${aiRes.status})`,
          details: errorText
        }), 
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const aiJson = await aiRes.json();
    const content = aiJson.choices[0].message.content;

    // Parse JSON
    let nutrition: NutritionInfo;
    try {
      console.log("Raw AI Content:", content.substring(0, 200));
      
      const firstOpen = content.indexOf('{');
      const lastClose = content.lastIndexOf('}');
      
      if (firstOpen !== -1 && lastClose !== -1 && lastClose > firstOpen) {
        const jsonStr = content.substring(firstOpen, lastClose + 1);
        nutrition = JSON.parse(jsonStr);
      } else {
        const cleanJson = content.replace(/```json/g, '').replace(/```/g, '').trim();
        nutrition = JSON.parse(cleanJson);
      }

      // Validate required fields
      if (!nutrition.foodName || nutrition.calories === undefined) {
        throw new Error("Missing required nutrition fields");
      }

      console.log(`Analyzed: ${nutrition.foodName} - ${nutrition.calories} calories`);

    } catch (e) {
      console.error("JSON Parse Error. Content snippet:", content.substring(0, 200));
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Failed to parse nutrition data',
          message: 'The AI could not analyze this image. Please ensure it contains a clear photo of food.'
        }), 
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check if it's actually food
    if (nutrition.confidence < 0.3) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Low confidence detection',
          message: 'This image might not contain food. Please upload a clear photo of your meal or food item.'
        }), 
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        nutrition,
        analyzedAt: new Date().toISOString()
      }), 
      { headers: { 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error("Nutrition Analysis Error:", error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message || 'Internal server error'
      }), 
      { 
        status: 500, 
        headers: { 'Content-Type': 'application/json' } 
      }
    );
  }
});

/* To invoke locally:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/analyze-nutrition' \
    --header 'Authorization: Bearer YOUR_TOKEN' \
    --header 'Content-Type: application/json' \
    --data '{
      "imageUrl": "https://example.com/food.jpg"
    }'

*/
