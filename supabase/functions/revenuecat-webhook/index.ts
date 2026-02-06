import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'jsr:@supabase/supabase-js@2'

console.log("RevenueCat Webhook Function Initialized")

Deno.serve(async (req) => {
  try {
    // 1. Verify Request (Basic Check)
    const authHeader = req.headers.get('Authorization');
    const expectedAuth = Deno.env.get('REVENUECAT_WEBHOOK_AUTH_TOKEN');
    
    // If you set a secret header in RevenueCat, check it here.
    if (expectedAuth && authHeader !== expectedAuth) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    const body = await req.json();
    const { event, api_version } = body;

    console.log(`🔔 Received Webhook Event: ${event?.type}`);

    if (!event) {
        return new Response(JSON.stringify({ message: 'No event data' }), { status: 200 });
    }

    // 2. Initialize Supabase Admin Client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 3. Extract Data
    const {
        type,
        app_user_id,
        product_id,
        purchased_at_ms,
        expiration_at_ms,
        store,
        environment,
        entitlement_ids
    } = event;

    // 4. Determine Status
    let status = 'active'; // Default
    if (type === 'EXPIRATION') {
        status = 'expired';
    } else if (type === 'CANCELLATION') {
        status = 'cancelled'; // Or 'active' until expiration? RC usually sends cancellation when auto-renew is off
        // Actually, for RC, cancellation usually means "will not renew", but access is valid until expiration.
        // But for our DB, we might want to know it's cancelled.
        // Let's stick to: expired = no access, active = access.
        // Users with 'cancelled' might still have access if expires_at > now.
        status = 'cancelled'; 
    } else if (type === 'BILLING_ISSUE') {
        status = 'billing_issue';
    }

    // Convert timestamps
    const purchasedAt = new Date(purchased_at_ms).toISOString();
    const expiresAt = expiration_at_ms ? new Date(expiration_at_ms).toISOString() : null;

    // 5. Find Supabase User ID
    // app_user_id could be the UUID or the Custom Mongo ID.
    let userId: string | null = null;

    // Check if it's a valid UUID (Supabase ID)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(app_user_id)) {
        userId = app_user_id;
    } else {
        // Look up profile by custom_user_id
        const { data: profile } = await supabase
            .from('profiles')
            .select('id')
            .eq('custom_user_id', app_user_id)
            .single();
        
        if (profile) {
            userId = profile.id;
        }
    }

    if (!userId) {
        console.error(`❌ User not found for app_user_id: ${app_user_id}`);
        // We return 200 to acknowledge receipt so RC doesn't retry endlessly for invalid users
        return new Response(JSON.stringify({ message: 'User not found in system' }), { status: 200 }); 
    }

    console.log(`✅ Updating Subscription for User: ${userId} (${status})`);

    // 6. Update Database
    // We use upsert on user_subscriptions. Assuming one active sub per user for simplicity, 
    // or we key by user_id. The table schema has id as PK, user_id as FK.
    // Ideally we might want a unique constraint on user_id for the "active" subscription?
    // Let's query first to see if an entry exists, or just upsert if we had a unique constraint.
    // The previous schema didn't enforce ONE subscription, so let's try to update the latest or insert.

    // Better strategy: Store the RevenueCat original_transaction_id or equivalent if possible to map 1:1.
    // But since the table is simple, let's just Upsert based on user_id if we want only 1 record per user.
    // However, the table doesn't have unique constraint on user_id.
    // Let's delete old ones or update the most recent? 
    // SAFEST implementation for this Hackathon:
    // Delete any existing record for this user and insert the new state. 
    // (Or Update if exists).
    
    // Check existing
    const { data: existing } = await supabase
        .from('user_subscriptions')
        .select('id')
        .eq('user_id', userId)
        .single();

    if (existing) {
        const { error } = await supabase
            .from('user_subscriptions')
            .update({
                status,
                product_id,
                purchased_at: purchasedAt,
                expires_at: expiresAt,
                platform: store === 'APP_STORE' ? 'ios' : 'android',
                store,
                environment,
                updated_at: new Date().toISOString()
            })
            .eq('id', existing.id);
            
        if (error) console.error('Update Error:', error);
    } else {
        const { error } = await supabase
            .from('user_subscriptions')
            .insert({
                user_id: userId,
                status,
                product_id,
                purchased_at: purchasedAt,
                expires_at: expiresAt,
                platform: store === 'APP_STORE' ? 'ios' : 'android',
                store,
                environment
            });
            
        if (error) console.error('Insert Error:', error);
    }

    // 7. Log Event
    await supabase.from('webhook_logs').insert({
        source: 'revenuecat',
        event_type: type,
        payload: event,
        success: true
    });

    return new Response(JSON.stringify({ message: 'Subscription updated' }), {
        headers: { "Content-Type": "application/json" },
        status: 200
    });

  } catch (err: any) {
    console.error('Webhook Error:', err);
    return new Response(JSON.stringify({ error: err.message || "Unknown error" }), {
        headers: { "Content-Type": "application/json" },
        status: 500
    });
  }
})
