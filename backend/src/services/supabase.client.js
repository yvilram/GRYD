const { createClient } = require("@supabase/supabase-js");

module.exports = function createSupabaseClient(env = process.env, accessToken) {
    const options = accessToken
        ? {
            auth: {
                autoRefreshToken: false,
                persistSession: false,
                detectSessionInUrl: false
            },
            global: {
                headers: {
                    Authorization: `Bearer ${accessToken}`
                }
            }
        }
        : undefined;

    return createClient(
        env.SUPABASE_URL,
        env.SUPABASE_PUBLISHABLE_KEY,
        options
    );
};

module.exports.createSupabaseAdminClient = function createSupabaseAdminClient(env = process.env) {
    if (!env.SUPABASE_SECRET_KEY) {
        throw new Error("SUPABASE_SECRET_KEY is not configured.");
    }

    return createClient(
        env.SUPABASE_URL,
        env.SUPABASE_SECRET_KEY,
        {
            auth: {
                autoRefreshToken: false,
                persistSession: false,
                detectSessionInUrl: false
            }
        }
    );
};
