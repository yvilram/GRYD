const createSupabaseClient = require("./supabase.client");

async function getSessionContext(request) {
    const token = request.cookies?.session;
    if (!token) return null;

    const supabase = createSupabaseClient(request.env, token);
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) return null;

    return { supabase, user: data.user, accessToken: token };
}

module.exports = { getSessionContext };
