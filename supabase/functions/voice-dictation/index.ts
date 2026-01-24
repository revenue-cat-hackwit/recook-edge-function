import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from '@supabase/supabase-js'

console.log("Voice Dictation v2 initialized")

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  // 1. Handle CORS Preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 2. Setup Supabase Client (Optional Auth Check)
    // We do NOT block if auth header is missing or weird, just log it.
    // This prevents 401 errors from loopback issues.
    
    // 3. Parse Audio File (FormData)
    let audioFile: File | null = null;
    
    try {
        const formData = await req.formData()
        audioFile = formData.get('audio') as File
    } catch (e) {
        return new Response(
            JSON.stringify({ error: 'Invalid start of multipart body', details: String(e) }), 
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
    
    if (!audioFile) {
        return new Response(
            JSON.stringify({ error: 'No audio file provided' }), 
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }

    const novitaKey = Deno.env.get('NOVITA_AI_API_KEY')
    if (!novitaKey) {
        console.error('Missing NOVITA_AI_API_KEY')
        throw new Error('Server Config Error: Missing API Key')
    }

    // 4. Call Novita GLM-ASR
    console.log(`Sending audio (${audioFile.size} bytes) to Novita GLM-ASR...`)
    
    const fileBuffer = await audioFile.arrayBuffer()
    const bytes = new Uint8Array(fileBuffer)
    let binary = ''
    const chunkSize = 8192
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
    }
    const base64Audio = btoa(binary)

    const sttRes = await fetch('https://api.novita.ai/v3/glm-asr', {
        method: 'POST',
        headers: { 
            'Authorization': `Bearer ${novitaKey}`,
            'Content-Type': 'application/json' 
        },
        body: JSON.stringify({ file: base64Audio })
    })

    if (!sttRes.ok) {
        const errText = await sttRes.text()
        console.error(`Novita Error: ${sttRes.status} -> ${errText}`)
        // Return 500 so client knows it's upstream error, not Auth 401
        return new Response(
            JSON.stringify({ error: `STT Provider Error (${sttRes.status})`, details: errText }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }

    const sttData = await sttRes.json()
    const text = sttData.text || sttData.transcript || ''
    
    console.log(`Transcription Success: "${text.substring(0, 50)}..."`)

    return new Response(
        JSON.stringify({ transcript: text }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Unhandled Error:', error)
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown Error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
