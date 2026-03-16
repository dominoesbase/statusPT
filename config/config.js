// CONFIGURAÇÃO SUPABASE
// Use sempre a 'anon' public key no front-end por questões de segurança.
const SUPABASE_URL = "https://xguvdncjvbxvulnxltgp.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhndXZkbmNqdmJ4dnVsbnhsdGdwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk2OTgxMzgsImV4cCI6MjA4NTI3NDEzOH0.Stzc97q6OND9QsEOX_uJ3OVHTLZhFAQgorRwCOSTf6I";

const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);