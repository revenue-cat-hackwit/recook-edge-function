# Pirinku Backend - Deployment

## Deploy Edge Functions

```bash
# Set secrets
supabase secrets set REVENUECAT_API_KEY=xxx
supabase secrets set REVENUECAT_WEBHOOK_SECRET=xxx
supabase secrets set NOVITA_AI_API_KEY=xxx

# Deploy all functions
supabase functions deploy

# Or deploy specific function
supabase functions deploy ai-assistant
```

## Database Setup

Run `schema.sql` in Supabase SQL Editor

## Function URLs

After deploy:

- https://pxhoqlzgkyflqlaixzkv.supabase.co/functions/v1/ai-assistant
- https://pxhoqlzgkyflqlaixzkv.supabase.co/functions/v1/revenuecat-webhook
- https://pxhoqlzgkyflqlaixzkv.supabase.co/functions/v1/verify-purchase
