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

On the dashboard, select a prompt-chain card to open its detail page. The
detail page shows its steps in order and provides controls to add, edit, delete,
and reorder them. Use **Back to All Chains** to return to the dashboard.

On a chain detail page, use **Run Chain** to execute its steps in order. The
“Funny Image Captions” chain requires a JPEG, PNG, or WebP image up to 10 MB.
Gemini requests run on the server and use each step's active `llm_models`
record. Intermediate and final outputs are streamed to the page and saved as
generation history. Uploaded image contents are not stored. Temporary HTTP
503/504 errors get at most two retries with exponential backoff; completed
steps are not repeated during those retries. **Test First Step Model** sends
one short Gemini request to verify access to the first step's configured model
and uses quota.

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
The step editor displays a temperature input only when the selected model has
`supports_temperature = true`; otherwise it leaves the existing temperature
unchanged and omits that field from the mutation.

## Gemini execution

Set `GEMINI_API_KEY` in the local server environment (for example, in the
ignored `.env.local` file) and in Vercel's server-side environment variables for
the environments where you run the app. Do not prefix it with `NEXT_PUBLIC_`.
No changes are needed to the `generations` or `prompt_chain_mixes` tables.
Persistent chain history writes to `generation_requests` and `llm_responses`.
Execution status uses the application-defined values `running`, `completed`,
`failed`, and `cancelled`; the database has no status check constraint.
Apply the following policies manually in Supabase; the application does not
change RLS policies:

```sql
CREATE POLICY "Superadmins can insert owned generation requests"
ON public.generation_requests
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND public.is_superadmin()
);

CREATE POLICY "Superadmins can update owned generation requests"
ON public.generation_requests
FOR UPDATE
TO authenticated
USING (
  user_id = auth.uid()
  AND public.is_superadmin()
)
WITH CHECK (
  user_id = auth.uid()
  AND public.is_superadmin()
);

CREATE POLICY "Superadmins can insert responses for owned requests"
ON public.llm_responses
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_superadmin()
  AND generation_request_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.generation_requests AS request
    WHERE request.id = generation_request_id
      AND request.user_id = auth.uid()
  )
);
```

Run the project checks with:

```bash
npm run lint
npm run build
```
