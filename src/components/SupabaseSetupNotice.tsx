import { Brand } from './Brand'

export function SupabaseSetupNotice() {
  return (
    <div className="setup-page">
      <div className="card setup-card">
        <Brand />
        <h2>Backend setup required</h2>
        <p className="text-lead">
          This app now uses Supabase for auth and data. Finish these steps to
          run it locally:
        </p>
        <ol>
          <li>Create a free project at supabase.com.</li>
          <li>
            Open the SQL editor and run every file in{' '}
            <code>supabase/migrations</code> in order (0001 → 0008).
          </li>
          <li>
            In Authentication → Providers → Email, turn off &quot;Confirm
            email&quot; (local development only).
          </li>
          <li>
            Copy <code>.env.example</code> to <code>.env</code> and fill in{' '}
            <code>VITE_SUPABASE_URL</code> and{' '}
            <code>VITE_SUPABASE_ANON_KEY</code>.
          </li>
          <li>Restart the dev server.</li>
        </ol>
      </div>
    </div>
  )
}
