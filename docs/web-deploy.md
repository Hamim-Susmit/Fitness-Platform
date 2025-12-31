# Web Deployment (Vercel)

## Prereqs
- Supabase project created
- Database schema applied (`schema.sql`)
- Edge Functions deployed

## Environment Variables
Set these in Vercel Project Settings:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL` (e.g. `https://<project-ref>.functions.supabase.co`)
- `NEXT_PUBLIC_SENTRY_DSN` (optional)

## Deploy Steps
1. Push your repository to GitHub.
2. Create a new Vercel project and import the repo.
3. Set the `Root Directory` to `web`.
4. Configure environment variables listed above.
5. Deploy.

## Post-Deploy
- Verify login works for all roles.
- Ensure Edge Functions are reachable and returning 200 responses.
- Check realtime updates on the staff dashboard.
