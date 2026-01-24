// Voice Processor: STT (GLM) -> LLM (Qwen) -> TTS (Minimax)
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'jsr:@supabase/supabase-js@2'

console.log("Voice Processor initialized")

// --- Configuration ---
const NOVITA_BASE_URL = 'https://api.novita.ai/v3/openai' // Check exact base URL for your specific endpoints
const LLM_MODEL = 'qwen/qwen3-vl-30b-a3b-instruct'
const STT_MODEL = 'glm-4-voice' // Placeholder name, check Novita docs for exact GLM Audio model ID
const TTS_MODEL = 'minimax-speech-02-hd' // Minimax HD model for better quality

Deno.serve(async (req) => {
  try {
    // 1. Auth Check
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    }

    const formData = await req.formData()
    const audioFile = formData.get('audio') as File
    
    if (!audioFile) {
        return new Response(JSON.stringify({ error: 'No audio file provided' }), { status: 400 })
    }

    const novitaKey = Deno.env.get('NOVITA_AI_API_KEY')
    if (!novitaKey) throw new Error('Missing Novita API Key (Check Supabase Secrets)')

    console.log(`[DEBUG] API Key present? ${!!novitaKey}`)

    // --- STEP 1: SPEECH TO TEXT (GLM) ---
    console.log(`[1/3] Transcribing audio with GLM-ASR...`)
    
    // Convert file to base64 for Novita GLM-ASR endpoint
    const fileBuffer = await audioFile.arrayBuffer()
    const base64Audio = btoa(String.fromCharCode(...new Uint8Array(fileBuffer)))
    
    console.log(`[DEBUG] Audio File Size: ${fileBuffer.byteLength} bytes`)
    console.log(`[DEBUG] Base64 Length: ${base64Audio.length}`)

    const sttRes = await fetch('https://api.novita.ai/v3/glm-asr', {
        method: 'POST',
        headers: { 
            'Authorization': `Bearer ${novitaKey}`,
            'Content-Type': 'application/json' 
        },
        body: JSON.stringify({
            file: base64Audio,
            // Only add these if strictly required by Novita docs
            // format: "m4a", 
        })
    })

    if (!sttRes.ok) {
        const errText = await sttRes.text()
        console.error(`[GLM Error] Status: ${sttRes.status}, Body: ${errText}`)
        throw new Error(`STT Error (Novita GLM): ${sttRes.status} - ${errText}`)
    }

    const sttData = await sttRes.json()
    const userText = sttData.text || sttData.transcript // Check output field name
    console.log(`User said: "${userText}"`)

    // --- STEP 2: BRAIN (LLM - QWEN) ---
    console.log(`[2/3] Thinking with ${LLM_MODEL}...`)

    const chatRes = await fetch(`${NOVITA_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${novitaKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: LLM_MODEL,
            messages: [
                { role: 'system', content: 'Kamu adalah Chef Pirinku yang ramah. Jawablah dengan singkat, padat, dan seperti berbicara lisan (conversational). Maksimal 2-3 kalimat.' },
                { role: 'user', content: userText }
            ],
            max_tokens: 150 // Keep it short for TTS speed
        })
    })

    if (!chatRes.ok) throw new Error(`LLM Error: ${await chatRes.text()}`)
    
    const chatData = await chatRes.json()
    const replyText = chatData.choices[0].message.content
    console.log(`Chef replies: "${replyText}"`)

    // --- STEP 3: TEXT TO SPEECH (MINIMAX HD) ---
    console.log(`[3/3] Generating voice with Minimax HD...`)

    const ttsRes = await fetch('https://api.novita.ai/v3/minimax-speech-02-hd', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${novitaKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            text: replyText,
            voice_setting: {
                voice_id: "male-qn-qingse", // Example voice ID (Male - Qingse)
                speed: 1,
                vol: 1,
                pitch: 0
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
    const audioBase64 = ttsData.audio // Minimax returns base64 directly in 'audio' field

    // --- FINISH ---
    return new Response(
        JSON.stringify({
            transcript: userText,
            reply: replyText,
            audio: audioBase64
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
