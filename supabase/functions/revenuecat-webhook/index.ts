// RevenueCat Webhook Handler
// Handles subscription events from RevenueCat
import { createClient } from 'jsr:@supabase/supabase-js@2'

console.log("RevenueCat Webhook Handler initialized")

interface RevenueCatEvent {
  event: {
    type: string
    app_user_id: string
    product_id: string
    period_type: string
    purchased_at_ms: number
    expiration_at_ms?: number
    store: string
    environment: string
  }
}

Deno.serve(async (req) => {
  try {
    // Verify webhook signature (RevenueCat sends this in headers)
    const signature = req.headers.get('X-RevenueCat-Signature')
    const webhookSecret = Deno.env.get('REVENUECAT_WEBHOOK_SECRET')

    // In production, verify the signature
    // For now, we'll skip verification in development

    const payload: RevenueCatEvent = await req.json()
    const { event } = payload

    console.log('Received RevenueCat event:', event.type)

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    // Handle different event types
    switch (event.type) {
      case 'INITIAL_PURCHASE':
      case 'RENEWAL':
        // Update user subscription status
        await supabase
          .from('user_subscriptions')
          .upsert({
            user_id: event.app_user_id,
            product_id: event.product_id,
            status: 'active',
            purchased_at: new Date(event.purchased_at_ms),
            expires_at: event.expiration_at_ms ? new Date(event.expiration_at_ms) : null,
            store: event.store,
            environment: event.environment,
            updated_at: new Date(),
          })
        break

      case 'CANCELLATION':
      case 'EXPIRATION':
        // Mark subscription as cancelled/expired
        await supabase
          .from('user_subscriptions')
          .update({
            status: 'expired',
            updated_at: new Date(),
          })
          .eq('user_id', event.app_user_id)
        break

      case 'BILLING_ISSUE':
        // Handle billing issues
        await supabase
          .from('user_subscriptions')
          .update({
            status: 'billing_issue',
            updated_at: new Date(),
          })
          .eq('user_id', event.app_user_id)
        break

      default:
        console.log('Unhandled event type:', event.type)
    }

    // Log the event
    await supabase
      .from('webhook_logs')
      .insert({
        source: 'revenuecat',
        event_type: event.type,
        payload: payload,
        processed_at: new Date(),
      })

    return new Response(
      JSON.stringify({ success: true, message: 'Webhook processed' }),
      {
        headers: { 'Content-Type': 'application/json' },
        status: 200
      }
    )

  } catch (error) {
    console.error('Error processing webhook:', error)

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
  2. Run `supabase functions serve revenuecat-webhook`
  3. Test with curl:

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

*/
