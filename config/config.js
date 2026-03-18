// CONFIGURAÇÃO SUPABASE
// Use sempre a 'anon' public key no front-end por questões de segurança.
const SUPABASE_URL = "";
const SUPABASE_KEY = "";

const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
