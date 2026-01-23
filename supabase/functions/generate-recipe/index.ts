import "https://esm.sh/@supabase/functions-js/src/edge-runtime.d.ts"

console.log("Generate Recipe function initialized")

interface RecipeRequest {
  videoUrl?: string
  prompt?: string
  ingredients?: string[] // Optional: list of available ingredients
  model?: string
}

// Helper to extract metadata AND Thumbnail from URL
interface VideoData {
  title: string;
  desc: string;
  thumbnailUrl?: string;
  platform: 'youtube' | 'tiktok' | 'instagram' | 'other';
}

async function fetchVideoData(url: string): Promise<VideoData> {
  console.log("Fetching data for:", url);
  const data: VideoData = { title: "Unknown", desc: "", platform: 'other' };
  
  try {
    // 1. Detect Platform & specific handling
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      data.platform = 'youtube';
      // Extract Video ID
      const videoId = url.match(/(?:youtu\.be\/|youtube\.com(?:\/embed\/|\/v\/|\/watch\?v=|\/watch\?.+&v=))([\w-]{11})/)?.[1];
      if (videoId) {
        data.thumbnailUrl = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
      }
    } else if (url.includes('tiktok.com')) {
      data.platform = 'tiktok';
    } else if (url.includes('instagram.com')) {
      data.platform = 'instagram';
    }

    // 2. Fetch Page for Metadata (Title, Desc, OG:Image)
    // Note: Some platforms block fetch without proper headers/cookies
    const response = await fetch(url, { 
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      } 
    });
    
    if (response.ok) {
      const html = await response.text();
      
      const titleMatch = html.match(/<title>(.*?)<\/title>/i);
      const descMatch = html.match(/<meta name="description" content="(.*?)"/i);
      const ogImageMatch = html.match(/<meta property="og:image" content="(.*?)"/i);

      if (titleMatch) data.title = titleMatch[1];
      if (descMatch) data.desc = descMatch[1];
      
      // Use og:image as thumbnail if we haven't found a better one (like YouTube's direct link)
      if (!data.thumbnailUrl && ogImageMatch) {
         // Some platforms escape characters, very basic unescape
         data.thumbnailUrl = ogImageMatch[1].replace(/&amp;/g, '&');
      }
    }
  } catch (_e) {
    console.error("Failed to fetch url data:", _e);
  }
  return data;
}

Deno.serve(async (req) => {
  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), { status: 401 })
    }

    const { videoUrl, prompt, ingredients, model = 'qwen/qwen3-vl-30b-a3b-instruct' }: RecipeRequest = await req.json()

    // Build Messages Payload
    const messages = [];
    
    // System Pormpt
    const systemPrompt = `You are a professional Chef AI named "Pirinku Chef".
    Your task is to generate a detailed cooking recipe based on the user's video input.
    I will provide you with the VIDEO THUMBNAIL (Visual) and METADATA (Title/Context).
    ANALYZE the image visually to identify the food, ingredients, and cooking style.
    
    OUTPUT FORMAT:
    You MUST respond with a single valid JSON object following this interface:
    {
      "title": "Nama Resep",
      "description": "Deskripsi singkat yang menggugah selera",
      "time_minutes": 30,
      "difficulty": "Easy" | "Medium" | "Hard",
      "servings": 4,
      "calories_per_serving": 350,
      "ingredients": [
        "200g ayam fillet",
        "1 sdt garam"
      ],
      "tools": [
        "Wajan anti lengket",
        "Spatula"
      ],
      "steps": [
        { "step": 1, "instruction": "Potong ayam dadu..." },
        { "step": 2, "instruction": "Panaskan minyak..." }
      ],
      "tips": "Tips tambahan agar masakan makin enak."
    }

    Do not include markdown formatting like \`\`\`json. Just raw JSON.`

    messages.push({ role: 'system', content: systemPrompt });

    // User Message Content Construction
    const userContent: any[] = [];
    userContent.push({ type: 'text', text: "Tolong buatkan resep untuk masakan di video ini." });

    if (videoUrl) {
      // Analyze Video URL
      const videoData = await fetchVideoData(videoUrl);
      
      // Add Context Text
      userContent.push({ 
        type: 'text', 
        text: `\n[VIDEO METADATA]\nURL: ${videoUrl}\nTitle: ${videoData.title}\nContext: ${videoData.desc}\nPlatform: ${videoData.platform}\n\nGunakan informasi di atas DAN GAMBAR yang saya kirim ini untuk menebak resepnya.` 
      });

      // Add Thumbnail Image if available
      if (videoData.thumbnailUrl) {
        console.log("Found thumbnail:", videoData.thumbnailUrl);
        userContent.push({
          type: 'image_url',
          image_url: { url: videoData.thumbnailUrl }
        });
      } else {
        userContent.push({ type: 'text', text: "(Maaf, saya tidak bisa mengambil gambar dari video ini. Tolong analisis dari Judul dan Deskripsi saja)." });
      }
    }
    
    if (ingredients && ingredients.length > 0) {
       userContent.push({ type: 'text', text: `Bahan yang saya punya: ${ingredients.join(', ')}.` });
    }

    if (prompt) {
       userContent.push({ type: 'text', text: `Tambahan keinginan user: ${prompt}` });
    }

    messages.push({ role: 'user', content: userContent });

    // Get Novita AI API key
    const novitaApiKey = Deno.env.get('NOVITA_AI_API_KEY')
    if (!novitaApiKey) {
      throw new Error('NOVITA_AI_API_KEY not configured')
    }

    // Call Novita AI
    const novitaResponse = await fetch('https://api.novita.ai/openai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${novitaApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model,
        messages: messages,
        max_tokens: 1500,
        temperature: 0.7,
        response_format: { type: "json_object" } // Force JSON mode if supported
      })
    })

    if (!novitaResponse.ok) {
       const err = await novitaResponse.text();
       console.error("AI Error:", err);
       throw new Error(`AI Provider Error: ${err}`);
    }

    const aiData = await novitaResponse.json()
    const rawContent = aiData.choices[0].message.content
    
    // Parse JSON safely
    let recipeData;
    try {
      // Remove potential markdown code blocks if AI puts them
      const cleanJson = rawContent.replace(/```json/g, '').replace(/```/g, '').trim();
      recipeData = JSON.parse(cleanJson);
    } catch (_e) {
      console.error("Failed to parse JSON:", rawContent);
      throw new Error("AI did not return valid JSON");
    }

    return new Response(
      JSON.stringify({ success: true, data: recipeData }),
      { headers: { 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    console.error(error)
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
