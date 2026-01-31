import "jsr:@supabase/functions-js/edge-runtime.d.ts"

console.log("Analyze Pantry Image function initialized")

const NOVITA_API_KEY = Deno.env.get('NOVITA_AI_API_KEY');

Deno.serve(async (req) => {
  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return new Response(JSON.stringify({ error: 'Missing auth header' }), { status: 401 })

    if (!NOVITA_API_KEY) return new Response(JSON.stringify({ error: 'Server Config Error' }), { status: 500 })

    const { imageUrl } = await req.json();
    if (!imageUrl) return new Response(JSON.stringify({ error: 'imageUrl is required' }), { status: 400 })

    const systemPrompt = `
      You are an AI Pantry Assistant.
      Identify all food items in the image (fridge, table, or grocery receipt).
      For each item, estimate:
      - Name (singular, e.g. "Egg", "Milk")
      - Quantity (e.g. "12 pcs", "1 liter", "About 500g")
      - Category ("Produce", "Dairy", "Meat", "Grains", "Other")
      - Expiry Estimation (YYYY-MM-DD from today, guess based on food type. e.g. Milk = +7 days, Vegetables = +5 days).

      OUTPUT: JSON Array only.
      Example: [{"name": "Milk", "quantity": "1L", "category": "Dairy", "expiry_date": "2024-01-01"}]
    `;

    // Define JSON Schema
    const pantrySchema = {
      "type": "json_schema",
      "json_schema": {
        "name": "pantry_response",
        "schema": {
          "type": "object",
          "properties": {
            "items": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "name": { "type": "string" },
                  "quantity": { "type": "string" },
                  "category": { "type": "string", "enum": ["Produce", "Dairy", "Meat", "Grains", "Snacks", "Beverage", "Other"] },
                  "expiry_date": { "type": "string", "description": "ISO Date YYYY-MM-DD" }
                },
                "required": ["name", "quantity", "category", "expiry_date"]
              }
            }
          },
          "required": ["items"]
        }
      }
    };

    const aiRes = await fetch('https://api.novita.ai/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${NOVITA_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: "qwen/qwen3-vl-30b-a3b-instruct",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: [
                    { type: "text", text: "Analyze this image and list the food items." },
                    { type: "image_url", image_url: { url: imageUrl } }
                ]}
            ],
            max_tokens: 2000,
            temperature: 0.1,
            response_format: pantrySchema
        })
    });

    if (!aiRes.ok) throw new Error(await aiRes.text());
    
    const aiJson = await aiRes.json();
    const content = aiJson.choices[0].message.content;

    let items = [];
    try {
        const clean = content.replace(/```json/g, '').replace(/```/g, '').trim();
        const first = clean.indexOf('[');
        const last = clean.lastIndexOf(']');
        if (first !== -1 && last !== -1) {
            items = JSON.parse(clean.substring(first, last + 1));
        } else {
             items = JSON.parse(clean);
        }
    } catch (e) {
        console.error("JSON Parse Error", content);
        throw new Error("Failed to parse pantry items");
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
