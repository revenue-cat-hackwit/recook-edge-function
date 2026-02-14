// Voice Processor: STT (Deepgram) & TTS (Novita Minimax Turbo)
import "jsr:@supabase/functions-js/edge-runtime.d.ts"

console.log("Voice Processor initialized (STT/TTS Only Mode - Minimax Turbo)")

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

        // Skip STT if TTS Only Request
        if (!config.tts_only) {
             if (!audioFile) throw new Error("No audio file provided for STT processing");

            const deepgramKey = Deno.env.get('DEEPGRAM_API_KEY');
            if (!deepgramKey) throw new Error("DEEPGRAM_API_KEY not configured");

            // Check language config (default id for STT if not specified)
            const lang = config.language === 'en' ? 'en' : 'id';
            
            // Deepgram Call (Nova-2 Model)
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
                 return new Response(JSON.stringify({ transcript: "", reply: "", audio: null, silent: true }), 
                    { headers: { 'Content-Type': 'application/json' } });
            }
        } 
    } else {
        // TEXT INPUT (JSON)
        const json = await req.json();
        userText = json.text;
        config = json.config || {};
    }
    
    // --- 2. CHECK MODE (STT ONLY or TTS ONLY) ---

    // A. STT ONLY MODE (Voice Command)
    if (config?.stt_only) {
        console.log(`[STT Only] Returning transcript: "${userText}"`);
        return new Response(
            JSON.stringify({
                transcript: userText,
                reply: "",
                audio: null
            }),
            { headers: { 'Content-Type': 'application/json' } }
        )
    }

    // B. TTS ONLY MODE (Read Recipe)
    let replyText = "";
    if (config?.tts_only) {
        replyText = config.input_text || userText; 
        if (!replyText) throw new Error("TTS Only mode requires text input");
        console.log(`[TTS Only] Generating speech for: "${replyText}"`);
    } else {
        replyText = userText; // Echo/Default
    }

    // --- 3. TEXT TO SPEECH (Novita Minimax Turbo) ---
    console.log(`[TTS] Generating...`)
    
    const novitaKey = Deno.env.get('NOVITA_AI_API_KEY')
    if (!novitaKey) throw new Error('Missing Novita API Key')

    // TTS Params
    const voiceId = config?.voiceId || "Wise_Woman";
    const speed = config?.speed || 1.0;
    const emotion = config?.emotion || "happy";
    const language = "en-US"; // Force English

    // Call Novita API V3
    const ttsRes = await fetch('https://api.novita.ai/v3/minimax-speech-02-turbo', {
         method: 'POST',
         headers: {
            'Authorization': `Bearer ${novitaKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            text: replyText,
            stream: false,
            output_format: "url", // Request URL to avoid Hex parsing
            voice_setting: {
                voice_id: voiceId,
                speed: speed,
                vol: 1.0,
                pitch: 0,
                emotion: emotion,
            },
            audio_setting: {
                format: "mp3",
                sample_rate: 32000,
                channel: 1,
            }
        })
    });

    if (!ttsRes.ok) {
        const err = await ttsRes.text();
        throw new Error(`TTS API Error: ${err}`);
    }
    
    const ttsData = await ttsRes.json();
    console.log("TTS Response:", JSON.stringify(ttsData));

    // Response format: { "audio": "https://..." }
    const audioUrl = ttsData.audio || ttsData.data?.audio || ttsData.data?.audio_url;

    if (!audioUrl) {
        throw new Error("No audio URL returned from TTS Service");
    }

    // DIRECT RETURN: Pass the S3 URL to the client.
    // The client will stream/download it directly from Novita's CDN.
    // This is much faster than proxying through Edge Function.
    
    return new Response(
        JSON.stringify({
            transcript: userText,
            reply: replyText,
            audio: audioUrl, // URL String
            isUrl: true // Flag for client
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
