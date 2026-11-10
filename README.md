# Prompt Chain Tool

The app uses Supabase Auth for administrator sign-in. The dashboard checks the
signed-in user's `profiles.is_superadmin` value on the server, matching the
profile row with `profiles.id = auth.users.id`.

## Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), then sign in with an
existing Supabase Auth account. Accounts without `is_superadmin = true` are
sent to the Access Denied page. The dashboard's Log out button ends the
Supabase session.

## Google OAuth configuration

Enable Google as a provider in Supabase Authentication and configure the
provider's Google OAuth client credentials. In Supabase Authentication URL
Configuration, add these application callback URLs to the allowed redirect
URLs:

- `http://localhost:3000/auth/callback`
- `https://YOUR-VERCEL-DOMAIN/auth/callback`

Replace `YOUR-VERCEL-DOMAIN` with the deployed Vercel hostname (and add any
custom production domain callback URL if one is used). The Google OAuth
provider's authorized redirect URI in Google Cloud must be the Supabase
project's callback URL shown in the Supabase Google provider settings,
typically `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback`. This is
different from the application callback URLs above.

## Supabase access requirements

The app uses the existing `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` environment variables. No service-role
key is used. Because the dashboard reads the current user's profile while
respecting Row Level Security, the `profiles` table needs a `SELECT` policy that
allows an authenticated user to read their own row (typically when
`auth.uid() = id`). If that policy is absent, the dashboard denies access and
logs the profile verification error; this app does not change database tables,
policies, or data.

Prompt-chain management also relies on RLS for `public.prompt_chains`. The
current authenticated user needs permission to select rows and, when authorized
as a superadmin by their profile, insert, update, and delete rows. The app checks
superadmin status on the server for every write, but it does not bypass RLS.
If a policy blocks an operation, the dashboard displays the Supabase permission
error. Review the existing policies in Supabase before changing them; no
database schema, records, or policies are modified by this app.

Step management uses `public.prompt_chain_steps` and reads active models from
`public.llm_models`. The authenticated user needs `SELECT` access to active
models and the step table, plus `INSERT`, `UPDATE`, and `DELETE` access on
`prompt_chain_steps` for the step operations. The app rechecks superadmin
status on the server for each step operation and continues to use the user's
RLS-scoped Supabase session. Creating a step requires at least one visible,
active model because `llm_model_id` references `llm_models`; no model records
are created automatically. If RLS prevents an operation, the interface shows
the database error and the corresponding policy requirement.

Run the project checks with:

```bash
npm run lint
npm run build
```
