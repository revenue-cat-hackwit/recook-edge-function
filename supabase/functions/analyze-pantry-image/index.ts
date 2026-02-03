import "jsr:@supabase/functions-js/edge-runtime.d.ts"

console.log("Analyze Pantry Image function initialized")

const NOVITA_API_KEY = Deno.env.get('NOVITA_AI_API_KEY');

Deno.serve(async (req) => {
  try {
    if (!NOVITA_API_KEY) return new Response(JSON.stringify({ error: 'Server Config Error' }), { status: 500 })

    const { imageUrl } = await req.json();
    if (!imageUrl) return new Response(JSON.stringify({ error: 'imageUrl is required' }), { status: 400 })

    const systemPrompt = `You are an AI Pantry Assistant.
Analyze the image and identify ALL food items visible.

CRITICAL VALIDATION:
1. First, check if the image contains FOOD ITEMS or INGREDIENTS.
2. If the image does NOT contain food (e.g., people, landscapes, objects, pets, etc.), respond with an EMPTY array: []
3. If food items ARE present, list them with name and quantity.

For each item, provide: name and estimated quantity.

CRITICAL: You MUST respond with ONLY a valid JSON array. No other text.
Format: [{"name": "Item Name", "quantity": "estimated amount"}]
Example: [{"name": "Tomato", "quantity": "5 pcs"}, {"name": "Milk", "quantity": "1 liter"}]
If NO food detected: []`;

    const requestPayload = {
      model: "qwen/qwen3-vl-30b-a3b-instruct",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: [
            { type: "text", text: "List all food items in this image as JSON array." },
            { type: "image_url", image_url: { url: imageUrl } }
        ]}
      ],
      max_tokens: 1000,
      temperature: 0.1
    };

    console.log("Sending to AI...");

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
        return new Response(JSON.stringify({ 
            success: false, 
            error: `AI Provider Error (${aiRes.status})`,
            details: errorText
        }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const aiJson = await aiRes.json();
    const content = aiJson.choices[0].message.content;

    // Parse JSON
    let items = [];
    try {
        console.log("Raw AI Content Length:", content.length);
        
        const firstOpen = content.indexOf('[');
        const lastClose = content.lastIndexOf(']');
        
        if (firstOpen !== -1 && lastClose !== -1 && lastClose > firstOpen) {
            const jsonStr = content.substring(firstOpen, lastClose + 1);
            items = JSON.parse(jsonStr);
        } else {
             const cleanJson = content.replace(/```json/g, '').replace(/```/g, '').trim();
             items = JSON.parse(cleanJson);
        }

        // Ensure array
        if (!Array.isArray(items)) items = [];

        // If empty array, it means no food was detected
        if (items.length === 0) {
            return new Response(JSON.stringify({ 
                success: false, 
                error: 'No food items detected',
                message: 'The image does not appear to contain any food items. Please upload a clear photo of your pantry, fridge, or food ingredients.'
            }), { 
                status: 400, 
                headers: { 'Content-Type': 'application/json' } 
            });
        }

    } catch (e) {
        console.error("JSON Parse Error. Content snippet:", content.substring(0, 100));
        throw new Error("Failed to parse pantry items from AI response");
    }

    return new Response(JSON.stringify({ success: true, data: items }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error("Analyze Pantry Error:", error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
})
