// Voice Processor: STT (GLM) -> LLM (Qwen) -> TTS (Minimax)
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'jsr:@supabase/supabase-js@2'

console.log("Voice Processor initialized")

// --- Configuration ---
const NOVITA_BASE_URL = 'https://api.novita.ai/v3/openai' // Check exact base URL for your specific endpoints
const LLM_MODEL = 'qwen/qwen3-vl-30b-a3b-instruct'
const TTS_MODEL = 'minimax-speech-02-turbo' // Turbo model for lower latency

Deno.serve(async (req) => {
  try {
    // 1. Auth Check
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    }

    const { text: userText, config } = await req.json()
    
    if (!userText) {
        return new Response(JSON.stringify({ error: 'No text provided' }), { status: 400 })
    }

    // Default Config
    const voiceId = config?.voiceId || "Wise_Woman";
    const speed = config?.speed || 1.0;
    const emotion = config?.emotion || "happy";
    const isPreview = config?.preview || false;
    const language = config?.language || "id"; // Default 'id'

    const novitaKey = Deno.env.get('NOVITA_AI_API_KEY')
    if (!novitaKey) throw new Error('Missing Novita API Key (Check Supabase Secrets)')

    console.log(`User said: "${userText}"`)
    console.log(`Voice Config: ${voiceId} (${speed}x, ${emotion}, Preview: ${isPreview}, Lang: ${language})`)

    let replyText = "";

    if (isPreview) {
        // --- PREVIEW MODE: SKIP LLM ---
        console.log(`[Preview Mode] Skipping LLM...`)
        replyText = language === 'en' ? "Hello, this is a sample of my voice." : "Halo, ini adalah contoh suara saya.";
    } else {
        // --- STEP 1: BRAIN (LLM - QWEN) ---
        console.log(`[1/2] Thinking with ${LLM_MODEL}...`)

        const systemPrompt = language === 'en' 
            ? 'You are Chef Pirinku, a friendly cooking assistant. Answer briefly, concisely, and conversationally (spoken style). Max 2-3 sentences.'
            : 'Kamu adalah Chef Pirinku yang ramah. Jawablah dengan singkat, padat, dan seperti berbicara lisan (conversational). Maksimal 2-3 kalimat.';

        const chatRes = await fetch(`${NOVITA_BASE_URL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${novitaKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: LLM_MODEL,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userText }
                ],
                max_tokens: 150 // Keep it short for TTS speed
            })
        })

        if (!chatRes.ok) throw new Error(`LLM Error: ${await chatRes.text()}`)
        
        const chatData = await chatRes.json()
        replyText = chatData.choices[0].message.content
        console.log(`Chef replies: "${replyText}"`)
    }

    // --- STEP 2: TEXT TO SPEECH (MINIMAX TURBO) ---
    console.log(`[2/2] Generating voice with ${TTS_MODEL}...`)

    const ttsRes = await fetch(`https://api.novita.ai/v3/${TTS_MODEL}`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${novitaKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            text: replyText,
            output_format: "url", // Request URL instead of Hex/Base64
            voice_setting: {
                voice_id: voiceId,
                speed: speed,
                vol: 1,
                pitch: 0,
                emotion: emotion
            },
            audio_setting: {
                sample_rate: 32000,
                bitrate: 128000,
                format: "mp3",
                channel: 1
            }
        })
    })

    if (!ttsRes.ok) {
        const err = await ttsRes.text()
        throw new Error(`TTS Error (Minimax): ${err}`)
    }

    const ttsData = await ttsRes.json()
    const audioUrl = ttsData.audio // Now contains HTTPS URL

    // --- FINISH ---
    return new Response(
        JSON.stringify({
            transcript: userText,
            reply: replyText,
            audio: audioUrl
        }),
        { headers: { 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Voice Processor Error:', error)
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown Error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
