// Hamster Friendship site configuration. OWNER SETTING: fill both values after creating the
// Supabase project (see README, "After launch"). Both are public by design: the anon/publishable
// key only reaches what the database's row level security allows. Never put the service role key here.
// While either value is empty the game runs guest-only and the Top 100 shows that it is not connected.
// `npm run build` rewrites this file from PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_ANON_KEY when they are set.
window.HAMSTER_CONFIG = {
  supabaseUrl: "",
  supabaseAnonKey: "",
};
