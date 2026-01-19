// Verify Purchase with RevenueCat API
// Extra security layer to validate purchases server-side
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'jsr:@supabase/supabase-js@2'

console.log("Verify Purchase function initialized")

interface VerifyPurchaseRequest {
  user_id: string
  receipt: string
  platform: 'ios' | 'android'
}

interface RevenueCatSubscriber {
  subscriber: {
    entitlements: Record<string, {
      expires_date: string | null
      product_identifier: string
      purchase_date: string
    }>
    subscriptions: Record<string, {
      expires_date: string
      purchase_date: string
      billing_issues_detected_at: string | null
    }>
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
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const { user_id, receipt, platform }: VerifyPurchaseRequest = await req.json()

    // Verify user_id matches authenticated user
    if (user_id !== user.id) {
      return new Response(
        JSON.stringify({ error: 'User ID mismatch' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Call RevenueCat API to verify the receipt
    const revenueCatApiKey = Deno.env.get('REVENUECAT_API_KEY')!
    const revenueCatUrl = `https://api.revenuecat.com/v1/subscribers/${user_id}`

    const rcResponse = await fetch(revenueCatUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${revenueCatApiKey}`,
        'Content-Type': 'application/json',
        'X-Platform': platform,
      }
    })

    if (!rcResponse.ok) {
      console.error('RevenueCat API error:', await rcResponse.text())
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Failed to verify purchase with RevenueCat'
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const rcData: RevenueCatSubscriber = await rcResponse.json()

    // Check if user has active entitlements
    const hasActiveEntitlement = Object.values(rcData.subscriber.entitlements).some(
      entitlement => {
        if (!entitlement.expires_date) return true // lifetime entitlement
        return new Date(entitlement.expires_date) > new Date()
      }
    )

    // Get active subscription details
    const activeSubscriptions = Object.entries(rcData.subscriber.subscriptions)
      .filter(([_, sub]) => {
        const expiresAt = new Date(sub.expires_date)
        const isActive = expiresAt > new Date() && !sub.billing_issues_detected_at
        return isActive
      })
      .map(([productId, sub]) => ({
        product_id: productId,
        expires_at: sub.expires_date,
        purchased_at: sub.purchase_date,
      }))

    // Update database with verified subscription
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)

    if (activeSubscriptions.length > 0) {
      const subscription = activeSubscriptions[0] // Get the first active subscription

      await supabaseAdmin
        .from('user_subscriptions')
        .upsert({
          user_id: user_id,
          product_id: subscription.product_id,
          status: 'active',
          purchased_at: new Date(subscription.purchased_at),
          expires_at: new Date(subscription.expires_at),
          platform: platform,
          verified_at: new Date(),
          updated_at: new Date(),
        })
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          has_active_entitlement: hasActiveEntitlement,
          active_subscriptions: activeSubscriptions,
          verified_at: new Date().toISOString(),
        }
      }),
      {
        headers: { 'Content-Type': 'application/json' },
        status: 200
      }
    )

  } catch (error) {
    console.error('Error verifying purchase:', error)

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
  2. Run `supabase functions serve verify-purchase`
  3. Test with curl:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/verify-purchase' \
    --header 'Authorization: Bearer YOUR_USER_JWT_TOKEN' \
    --header 'Content-Type: application/json' \
    --data '{
      "user_id": "user123",
      "receipt": "base64_encoded_receipt",
      "platform": "ios"
    }'

  This function:
  - Validates the user is authenticated
  - Calls RevenueCat API to verify the purchase
  - Updates the database with verified subscription status
  - Returns active entitlements and subscriptions
*/
