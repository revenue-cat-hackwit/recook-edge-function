# 🚀 Quick Start Guide - Pirinku Backend

## Langkah-langkah Setup Edge Functions

### 1️⃣ **Setup Supabase Project**

1. Buat project di [supabase.com](https://supabase.com)
2. Copy Project URL dan API Keys dari Settings → API

### 2️⃣ **Setup Database**

1. Buka SQL Editor di Supabase Dashboard
2. Copy isi file `schema.sql`
3. Run SQL query untuk membuat tables, indexes, dan policies

### 3️⃣ **Link Project ke Local**

```bash
cd pirinku-backend

# Login ke Supabase
supabase login

# Link ke project (ganti YOUR_PROJECT_REF dengan ref project Anda)
supabase link --project-ref YOUR_PROJECT_REF
```

### 4️⃣ **Setup Environment Variables**

```bash
# Copy example file
cp .env.example .env

# Edit .env dan isi dengan credentials Anda
nano .env
```

Isi `.env`:
```env
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGc...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...
REVENUECAT_API_KEY=sk_...
REVENUECAT_WEBHOOK_SECRET=...
```

### 5️⃣ **Test Locally**

```bash
# Start Supabase local development
supabase start

# Serve functions
supabase functions serve --env-file .env

# Test di terminal lain
curl http://127.0.0.1:54321/functions/v1/hello-world \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"Pirinku"}'
```

### 6️⃣ **Deploy ke Production**

```bash
# Set secrets di Supabase
supabase secrets set REVENUECAT_API_KEY=sk_xxx
supabase secrets set REVENUECAT_WEBHOOK_SECRET=xxx

# Deploy functions
supabase functions deploy revenuecat-webhook
supabase functions deploy verify-purchase

# Atau deploy semua sekaligus
supabase functions deploy
```

### 7️⃣ **Setup RevenueCat Webhook**

1. Login ke [RevenueCat Dashboard](https://app.revenuecat.com)
2. Pilih project Anda
3. Go to: **Project Settings → Integrations → Webhooks**
4. Add new webhook:
   - URL: `https://YOUR_PROJECT.supabase.co/functions/v1/revenuecat-webhook`
   - Events: Select all subscription events
5. Copy webhook secret dan tambahkan ke Supabase secrets

### 8️⃣ **Integrate dengan Mobile App**

Di mobile app (`pirinku`), install Supabase client:

```bash
cd ../pirinku
npm install @supabase/supabase-js
```

Buat file `lib/supabase.ts`:

```typescript
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
```

Call Edge Function dari app:

```typescript
// Verify purchase setelah user beli subscription
async function handlePurchaseSuccess(userId: string, receipt: string) {
  const { data, error } = await supabase.functions.invoke('verify-purchase', {
    body: {
      user_id: userId,
      receipt: receipt,
      platform: Platform.OS === 'ios' ? 'ios' : 'android'
    }
  })
  
  if (data?.success) {
    console.log('Purchase verified!', data.data)
  }
}
```

## 📊 Monitoring

### View Logs

```bash
# View function logs
supabase functions logs revenuecat-webhook

# Follow logs in real-time
supabase functions logs revenuecat-webhook --follow
```

### Check Webhook Logs di Database

```sql
-- View recent webhook events
SELECT * FROM webhook_logs 
ORDER BY processed_at DESC 
LIMIT 10;

-- Check for errors
SELECT * FROM webhook_logs 
WHERE success = false 
ORDER BY processed_at DESC;
```

### Check Active Subscriptions

```sql
-- View all active subscriptions
SELECT * FROM active_subscriptions;

-- Count active users
SELECT COUNT(DISTINCT user_id) as active_subscribers
FROM user_subscriptions
WHERE status = 'active' 
  AND (expires_at IS NULL OR expires_at > NOW());
```

## 🔧 Troubleshooting

### Function tidak bisa dipanggil
- ✅ Check apakah function sudah di-deploy: `supabase functions list`
- ✅ Verify environment secrets: `supabase secrets list`
- ✅ Check logs untuk error: `supabase functions logs FUNCTION_NAME`

### Webhook tidak masuk
- ✅ Verify webhook URL di RevenueCat Dashboard
- ✅ Check webhook logs di RevenueCat untuk delivery status
- ✅ Test webhook manually dengan curl

### Database error
- ✅ Verify RLS policies sudah benar
- ✅ Check apakah user authenticated
- ✅ Verify service role key untuk admin operations

## 📚 Next Steps

1. ✅ Implement authentication di mobile app
2. ✅ Integrate RevenueCat SDK di mobile app
3. ✅ Test purchase flow end-to-end
4. ✅ Setup monitoring dan alerts
5. ✅ Add analytics tracking

## 🆘 Need Help?

- [Supabase Docs](https://supabase.com/docs)
- [RevenueCat Docs](https://www.revenuecat.com/docs)
- [Deno Docs](https://deno.land/manual)
