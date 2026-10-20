import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

if (!isSupabaseConfigured) {
  const missing = [
    supabaseUrl ? null : 'VITE_SUPABASE_URL',
    supabaseAnonKey ? null : 'VITE_SUPABASE_ANON_KEY',
  ].filter((name): name is string => Boolean(name))
  console.warn(
    `[supabase] Not configured — missing ${missing.join(' and ')} in .env. Copy .env.example to .env and restart the dev server.`,
  )
} else if (import.meta.env.DEV) {
  console.info(`[supabase] Configured with ${supabaseUrl}`)
}

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl as string, supabaseAnonKey as string)
  : null

export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured. Copy .env.example to .env and add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
    )
  }
  return supabase
}
