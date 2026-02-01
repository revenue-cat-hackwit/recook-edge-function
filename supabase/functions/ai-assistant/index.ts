// AI Assistant with Novita AI (Qwen3-VL-30B)
// Unified multimodal AI function supporting text chat and image analysis
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from '@supabase/supabase-js'

console.log("AI Assistant function initialized")

interface MessageContent {
  type: 'text' | 'image_url' | 'video_url'
  text?: string
  image_url?: {
    url: string
  }
  video_url?: {
    url: string
  }
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | MessageContent[]
}

interface AIRequest {
  messages: ChatMessage[]
  max_tokens?: number
  temperature?: number
  model?: string
}

interface NovitaResponse {
  choices: Array<{
    message: {
      role: string
      content: string
    }
    finish_reason: string
  }>
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

Deno.serve(async (req) => {
  try {
    // Get the authorization header
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } }
    })

    // Verify user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    // TEST MODE: Skip auth check (REMOVE IN PRODUCTION!)
    const testMode = true
    if (!testMode && (authError || !user)) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Check if user has active subscription (optional - for premium features)
    // ... (Auth Logic) ...

    const { data: subscription } = await supabase
      .from('user_subscriptions')
      .select('status, expires_at')
      .eq('user_id', user?.id || 'test-user')
      .eq('status', 'active')
      .single()

    const hasActiveSubscription = subscription && 
      (!subscription.expires_at || new Date(subscription.expires_at) > new Date())

    // --- CONTEXT RETRIEVAL (The "Super App" Logic) ---
    // 1. Fetch Profile (Preferences)
    const { data: profile } = await supabase
        .from('profiles')
        .select('allergies, diet_goal, equipment')
        .eq('id', user?.id)
        .single();
    
    // 2. Fetch Pantry
    const { data: pantry } = await supabase
        .from('pantry_items')
        .select('ingredient_name, quantity, expiry_date')
        .eq('user_id', user?.id)
        .order('expiry_date', { ascending: true }); // Use expiring first

    // 3. Build Context String
    let systemContext = "You are Chef Pirinku, an expert cooking assistant. Be helpful, concise, and friendly. You MUST communicate in English.";
    
    if (profile) {
        if (profile.diet_goal) systemContext += `\nUser's Goal: ${profile.diet_goal}.`;
        if (profile.allergies && profile.allergies.length > 0) systemContext += `\nALLERGIES (CRITICAL): ${profile.allergies.join(', ')}.`;
        if (profile.equipment && profile.equipment.length > 0) systemContext += `\nKitchen Tools: ${profile.equipment.join(', ')}.`;
    }

    if (pantry && pantry.length > 0) {
        const ingredients = pantry.map((item: any) => 
            `- ${item.ingredient_name} (${item.quantity})`
        ).join('\n');
        systemContext += `\n\n[USER PANTRY INVENTORY - USE THESE INGREDIENTS IF POSSIBLE]:\n${ingredients}`;
    } else {
         systemContext += `\n\n[User Pantry is Empty]`;
    }

    // Parse request body
    const { 
      messages, 
      max_tokens = 1000, 
      temperature = 0.7,
      model = 'qwen/qwen3-vl-30b-a3b-instruct'
    }: AIRequest = await req.json()

    if (!messages || messages.length === 0) {
      return new Response(JSON.stringify({ error: 'Messages array is required' }), { status: 400 });
    }

    // 4. Inject System Prompt
    // Check if first message is system
    const finalMessages = [...messages];
    if (finalMessages.length > 0 && finalMessages[0].role === 'system') {
        // Append to existing system prompt (assuming text content)
        if (typeof finalMessages[0].content === 'string') {
            finalMessages[0].content = systemContext + "\n\n" + finalMessages[0].content;
        }
    } else {
        // Prepend new system prompt
        finalMessages.unshift({ role: 'system', content: systemContext });
    }

    // Get Novita AI API key
    const novitaApiKey = Deno.env.get('NOVITA_AI_API_KEY')
    if (!novitaApiKey) {
      console.error('NOVITA_AI_API_KEY not set')
      return new Response(JSON.stringify({ error: 'AI service not configured' }), { status: 500 });
    }

    // Determine task type based on message content
    let taskType = 'chat'
    for (const message of finalMessages) { // Use finalMessages
      if (Array.isArray(message.content)) {
        const hasImage = message.content.some((c: any) => c.type === 'image_url')
        if (hasImage) {
          taskType = 'image_analysis'
          break
        }
      }
    } 

    // Call Novita AI API (OpenAI-compatible)
    const novitaResponse = await fetch('https://api.novita.ai/openai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${novitaApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model,
        messages: finalMessages, // Use Context-Aware Messages
        max_tokens: max_tokens,
        temperature: temperature,
      })
    })

    if (!novitaResponse.ok) {
      const errorText = await novitaResponse.text()
      console.error('Novita AI API error:', errorText)
      return new Response(
        JSON.stringify({ 
          error: 'AI service error',
          details: errorText 
        }),
        { status: novitaResponse.status, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const aiResponse: NovitaResponse = await novitaResponse.json()

    // Log usage for analytics (optional)
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)

    // Use then() instead of catch() for error handling
    supabaseAdmin
      .from('ai_usage_logs')
      .insert({
        user_id: user?.id || 'test-user',
        model: model.split('/').pop() || model,
        task_type: taskType,
        prompt_tokens: aiResponse.usage.prompt_tokens,
        completion_tokens: aiResponse.usage.completion_tokens,
        total_tokens: aiResponse.usage.total_tokens,
        has_subscription: hasActiveSubscription,
        created_at: new Date().toISOString(),
      })
      .then(({ error }) => {
        if (error) console.error('Failed to log usage:', error)
      })

    // Return AI response
    return new Response(
      JSON.stringify({
        success: true,
        data: {
          message: aiResponse.choices[0].message.content,
          role: aiResponse.choices[0].message.role,
          finish_reason: aiResponse.choices[0].finish_reason,
          usage: aiResponse.usage,
          task_type: taskType,
        }
      }),
      { 
        headers: { 'Content-Type': 'application/json' },
        status: 200 
      }
    )

  } catch (error) {
    console.error('Error in AI assistant:', error)
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }),
      { 
        headers: { 'Content-Type': 'application/json' },
        status: 500 
      }
    )
  }
})

/* To invoke locally:

  1. Run `supabase start`
  2. Set NOVITA_AI_API_KEY in .env
  3. Run `supabase functions serve ai-assistant --env-file .env`
  4. Test with curl:

  # Text chat
  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/ai-assistant' \
    --header 'Authorization: Bearer YOUR_USER_JWT_TOKEN' \
    --header 'Content-Type: application/json' \
    --data '{
      "messages": [
        { "role": "system", "content": "You are a helpful assistant for Pirinku app." },
        { "role": "user", "content": "What is Pirinku?" }
      ],
      "max_tokens": 500,
      "temperature": 0.7
    }'

  # Image analysis
  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/ai-assistant' \
    --header 'Authorization: Bearer YOUR_USER_JWT_TOKEN' \
    --header 'Content-Type: application/json' \
    --data '{
      "messages": [
        {
          "role": "user",
          "content": [
            { "type": "text", "text": "What is in this image?" },
            { "type": "image_url", "image_url": { "url": "https://example.com/image.jpg" } }
          ]
        }
      ],
      "max_tokens": 500
    }'

  # Image analysis with base64
  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/ai-assistant' \
    --header 'Authorization: Bearer YOUR_USER_JWT_TOKEN' \
    --header 'Content-Type: application/json' \
    --data '{
      "messages": [
        {
          "role": "user",
          "content": [
            { "type": "text", "text": "Extract text from this receipt" },
            { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,iVBORw0KGgo..." } }
          ]
        }
      ]
    }'

  Use cases:
  - Chat assistant for app help
  - Receipt scanning and OCR
  - Product identification from images
  - Image moderation
  - Visual search
  - Accessibility (image descriptions)
  - Multi-turn conversations
*/
