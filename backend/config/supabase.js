const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_KEY in environment variables");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: true, persistSession: false },
});

// Verify connection with a real table on startup
supabase
  .from("emergency_contacts")
  .select("id")
  .limit(1)
  .then(({ error }) => {
    if (error) {
      console.error("Supabase connection FAILED:", error.message);
      // TEMP DIAGNOSTIC: error.message on a "TypeError: fetch failed" is a
      // generic wrapper — the real network cause (ENOTFOUND/ECONNREFUSED/
      // ETIMEDOUT/TLS/etc.) lives in error.cause. Never logs the key.
      if (error.cause) {
        console.error("  → underlying cause:", error.cause.code || error.cause.message || error.cause);
      }
    } else {
      console.log("Supabase connected successfully:", supabaseUrl);
    }
  });

module.exports = supabase;
