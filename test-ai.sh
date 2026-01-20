#!/bin/bash

# Test AI Assistant Function (Production)
# Ganti YOUR_USER_JWT dengan token dari Supabase Auth

echo "Testing AI Assistant..."

curl -i --location --request POST 'https://pxhoqlzgkyflqlaixzkv.supabase.co/functions/v1/ai-assistant' \
  --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
  --header 'Content-Type: application/json' \
  --data '{
    "messages": [
      { "role": "user", "content": "Hello, test!" }
    ],
    "max_tokens": 100
  }'
