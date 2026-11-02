/* const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_PUBLISHABLE_KEY
);

module.exports = supabase; */

const { createClient } = require('@supabase/supabase-js');

function getSupabase(env = process.env) {
    return createClient(
        env.SUPABASE_URL,
        env.SUPABASE_PUBLISHABLE_KEY
    );
}

module.exports = getSupabase;