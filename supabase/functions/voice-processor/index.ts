// Voice Processor: STT (Deepgram/Text) -> LLM (Qwen) -> TTS (Minimax)
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'jsr:@supabase/supabase-js@2'

console.log("Voice Processor initialized (Deepgram Enabled)")

// --- Configuration ---
const NOVITA_BASE_URL = 'https://api.novita.ai/openai/v1' 
const LLM_MODEL = 'qwen/qwen3-vl-30b-a3b-instruct'
const TTS_MODEL = 'minimax-speech-02-turbo' 

Deno.serve(async (req) => {
  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    }

    let userText = "";
    let config: any = {};

    const contentType = req.headers.get('content-type') || "";

    // --- 1. HANDLE INPUT (AUDIO vs TEXT) ---
    if (contentType.includes('multipart/form-data')) {
        // AUDIO INPUT -> DEEPGRAM STT
        console.log("Processing Audio Input...");
        const formData = await req.formData();
        const audioFile = formData.get('audio') as File;
        const configStr = formData.get('config') as string;
        
        if (configStr) config = JSON.parse(configStr);
        if (!audioFile) throw new Error("No audio file provided in form data");

        const deepgramKey = Deno.env.get('DEEPGRAM_API_KEY');
        if (!deepgramKey) throw new Error("DEEPGRAM_API_KEY not configured");

        const lang = config.language === 'en' ? 'en' : 'id';
        
        // Deepgram Call
        const deepgramRes = await fetch(`https://api.deepgram.com/v1/listen?model=nova-2&language=${lang}&smart_format=true`, {
            method: 'POST',
            headers: {
                'Authorization': `Token ${deepgramKey}`,
                'Content-Type': audioFile.type || 'audio/wav'
            },
            body: audioFile
        });

        if (!deepgramRes.ok) {
            const err = await deepgramRes.text();
            throw new Error(`Deepgram STT Error: ${err}`);
        }

        const deepgramData = await deepgramRes.json();
        userText = deepgramData.results?.channels[0]?.alternatives[0]?.transcript || "";
        
        console.log(`Transcribed Audio: "${userText}"`);
        
        if (!userText.trim()) {
             // Return early if silence/no speech detected to save LLM tokens
             return new Response(JSON.stringify({ transcript: "", reply: "", audio: null, silent: true }), 
                { headers: { 'Content-Type': 'application/json' } });
        }

    } else {
        // TEXT INPUT (JSON)
        const json = await req.json();
        userText = json.text;
        config = json.config || {};
    }
    
    // --- 2. CONFIGURATION ---
    const voiceId = config?.voiceId || "Wise_Woman";
    const speed = config?.speed || 1.0;
    const emotion = config?.emotion || "happy";
    const isPreview = config?.preview || false;
    const language = config?.language || "id";

    const novitaKey = Deno.env.get('NOVITA_AI_API_KEY')
    if (!novitaKey) throw new Error('Missing Novita API Key')

    console.log(`Processing: "${userText}" (Lang: ${language}, Voice: ${voiceId})`);

    // --- SHORTCUT: STT ONLY ---
    if (config?.stt_only) {
        console.log(`[STT Only] Returning transcript.`);
        return new Response(
            JSON.stringify({
                transcript: userText,
                reply: "",
                audio: null
            }),
            { headers: { 'Content-Type': 'application/json' } }
        )
    }

    let replyText = "";

    if (isPreview) {
        replyText = language === 'en' ? "Hello, this is a sample of my voice." : "Halo, ini adalah contoh suara saya.";
    } else {
        // --- STEP 3: BRAIN (LLM) ---
        console.log(`[LLM] Thinking...`)
        const systemPrompt = language === 'en' 
            ? 'You are Chef Pirinku, a friendly cooking assistant. Answer briefly, concisely, and conversationally (spoken style). Max 2-3 sentences. Do not use markdown (* or #).'
            : 'Kamu adalah Chef Pirinku yang ramah dan asik. Jawablah dengan singkat, padat, dan seperti berbicara lisan (conversational). Maksimal 2-3 kalimat. Jangan gunakan markdown (* atau #).';

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
                max_tokens: 150
            })
        })

        if (!chatRes.ok) throw new Error(`LLM Error: ${await chatRes.text()}`)
        
        const chatData = await chatRes.json()
        replyText = chatData.choices[0].message.content
        console.log(`Chef replies: "${replyText}"`)
    }

    // --- STEP 4: TEXT TO SPEECH ---
    console.log(`[TTS] Generating...`)
    const ttsRes = await fetch(`https://api.novita.ai/v3/${TTS_MODEL}`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${novitaKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            text: replyText,
            output_format: "url",
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

    if (!ttsRes.ok) throw new Error(`TTS Error: ${await ttsRes.text()}`)

    const ttsData = await ttsRes.json()
    const audioUrl = ttsData.audio 

    return new Response(
        JSON.stringify({
            transcript: userText,
            reply: replyText,
            audio: audioUrl
        }),
        { headers: { 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    console.error('Voice Processor Error:', error)
    return new Response(
      JSON.stringify({ error: error.message || 'Unknown Error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
