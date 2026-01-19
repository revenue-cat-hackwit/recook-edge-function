# Pirinku Backend - Supabase Edge Functions

Backend serverless functions untuk aplikasi Pirinku menggunakan Supabase Edge Functions.

## 📁 Struktur Project

```
pirinku-backend/
├── supabase/
│   ├── functions/
│   │   ├── hello-world/          # Example function
│   │   ├── revenuecat-webhook/   # Handle RevenueCat webhooks
│   │   └── verify-purchase/      # Verify purchases server-side
│   └── config.toml               # Supabase configuration
├── .vscode/
│   └── settings.json             # Deno settings
└── README.md
```

## 🚀 Setup

### Prerequisites

- [Supabase CLI](https://supabase.com/docs/guides/cli) installed
- [Deno](https://deno.land/) installed (for local development)
- Supabase project (create at [supabase.com](https://supabase.com))

### Installation

1. **Login to Supabase**
   ```bash
   supabase login
   ```

2. **Link to your Supabase project**
   ```bash
   supabase link --project-ref YOUR_PROJECT_REF
   ```

3. **Set up environment variables**
   
   Create `.env` file (gitignored):
   ```bash
   # Supabase
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_ANON_KEY=your-anon-key
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   
   # RevenueCat
   REVENUECAT_API_KEY=your-revenuecat-api-key
   REVENUECAT_WEBHOOK_SECRET=your-webhook-secret
   ```

## 🛠️ Development

### Run Functions Locally

1. **Start Supabase locally**
   ```bash
   supabase start
   ```

2. **Serve a specific function**
   ```bash
   supabase functions serve revenuecat-webhook --env-file .env
   ```

3. **Serve all functions**
   ```bash
   supabase functions serve --env-file .env
   ```

### Test Functions

**Test RevenueCat Webhook:**
```bash
curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/revenuecat-webhook' \
  --header 'Authorization: Bearer YOUR_ANON_KEY' \
  --header 'Content-Type: application/json' \
  --data '{
    "event": {
      "type": "INITIAL_PURCHASE",
      "app_user_id": "user123",
      "product_id": "premium_monthly",
      "period_type": "NORMAL",
      "purchased_at_ms": 1705680000000,
      "expiration_at_ms": 1708358400000,
      "store": "APP_STORE",
      "environment": "PRODUCTION"
    }
  }'
```

**Test Verify Purchase:**
```bash
curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/verify-purchase' \
  --header 'Authorization: Bearer YOUR_USER_JWT_TOKEN' \
  --header 'Content-Type: application/json' \
  --data '{
    "user_id": "user123",
    "receipt": "base64_receipt",
    "platform": "ios"
  }'
```

## 🚢 Deployment

### Deploy to Supabase

1. **Deploy a specific function**
   ```bash
   supabase functions deploy revenuecat-webhook
   ```

2. **Deploy all functions**
   ```bash
   supabase functions deploy
   ```

3. **Set environment secrets**
   ```bash
   supabase secrets set REVENUECAT_API_KEY=your-key
   supabase secrets set REVENUECAT_WEBHOOK_SECRET=your-secret
   ```

### Get Function URLs

After deployment, your functions will be available at:
```
https://YOUR_PROJECT_REF.supabase.co/functions/v1/FUNCTION_NAME
```

Example:
```
https://abcdefgh.supabase.co/functions/v1/revenuecat-webhook
```

## 📝 Edge Functions

### 1. `revenuecat-webhook`

**Purpose:** Handle subscription events from RevenueCat

**Endpoint:** `POST /functions/v1/revenuecat-webhook`

**Events Handled:**
- `INITIAL_PURCHASE` - New subscription
- `RENEWAL` - Subscription renewed
- `CANCELLATION` - Subscription cancelled
- `EXPIRATION` - Subscription expired
- `BILLING_ISSUE` - Payment failed

**Database Updates:**
- Updates `user_subscriptions` table
- Logs events to `webhook_logs` table

**Setup in RevenueCat:**
1. Go to RevenueCat Dashboard → Project Settings → Webhooks
2. Add webhook URL: `https://YOUR_PROJECT.supabase.co/functions/v1/revenuecat-webhook`
3. Copy the webhook secret and add to Supabase secrets

### 2. `verify-purchase`

**Purpose:** Verify purchases server-side for extra security

**Endpoint:** `POST /functions/v1/verify-purchase`

**Request Body:**
```json
{
  "user_id": "string",
  "receipt": "string",
  "platform": "ios" | "android"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "has_active_entitlement": true,
    "active_subscriptions": [
      {
        "product_id": "premium_monthly",
        "expires_at": "2024-01-20T00:00:00Z",
        "purchased_at": "2024-01-01T00:00:00Z"
      }
    ],
    "verified_at": "2024-01-19T20:35:00Z"
  }
}
```

**Use Case:**
- Call this after a purchase to verify it server-side
- Prevents fraud and ensures subscription is valid
- Updates local database with verified status

## 🗄️ Database Schema

### `user_subscriptions`

```sql
CREATE TABLE user_subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  product_id TEXT NOT NULL,
  status TEXT NOT NULL, -- 'active', 'expired', 'billing_issue'
  purchased_at TIMESTAMP WITH TIME ZONE NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE,
  platform TEXT, -- 'ios', 'android'
  store TEXT, -- 'APP_STORE', 'PLAY_STORE'
  environment TEXT, -- 'PRODUCTION', 'SANDBOX'
  verified_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_user_subscriptions_user_id ON user_subscriptions(user_id);
CREATE INDEX idx_user_subscriptions_status ON user_subscriptions(status);
```

### `webhook_logs`

```sql
CREATE TABLE webhook_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source TEXT NOT NULL, -- 'revenuecat'
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  processed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_webhook_logs_source ON webhook_logs(source);
CREATE INDEX idx_webhook_logs_processed_at ON webhook_logs(processed_at);
```

## 🔒 Security

- **Authentication:** All functions verify JWT tokens from Supabase Auth
- **Authorization:** User ID validation to prevent unauthorized access
- **Secrets:** API keys stored in Supabase secrets, never in code
- **Webhook Verification:** RevenueCat webhook signature validation (implement in production)

## 📚 Resources

- [Supabase Edge Functions Docs](https://supabase.com/docs/guides/functions)
- [RevenueCat Webhooks](https://www.revenuecat.com/docs/webhooks)
- [Deno Documentation](https://deno.land/manual)

## 🤝 Integration with Mobile App

In your React Native app (`pirinku`), call these functions:

```typescript
import { supabase } from './lib/supabase'

// Verify purchase after successful transaction
async function verifyPurchase(userId: string, receipt: string, platform: 'ios' | 'android') {
  const { data, error } = await supabase.functions.invoke('verify-purchase', {
    body: { user_id: userId, receipt, platform }
  })
  
  if (error) {
    console.error('Verification failed:', error)
    return false
  }
  
  return data.success
}
```

## 📞 Support

For issues or questions, check:
- Supabase logs: `supabase functions logs FUNCTION_NAME`
- RevenueCat dashboard for webhook delivery status
- Database logs in `webhook_logs` table
