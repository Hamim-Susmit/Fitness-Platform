# Supabase Deployment

## Database Migrations
Apply the schema:
```bash
psql "${SUPABASE_DB_URL}" -f schema.sql
```

## Edge Functions
Deploy functions from the repo root:
```bash
supabase functions deploy generate_qr_token
supabase functions deploy validate_qr_token
```

## Required Secrets
Set service role and anon keys for functions:
```bash
supabase secrets set SUPABASE_URL=<project-url>
supabase secrets set SUPABASE_ANON_KEY=<anon-key>
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
```

## Realtime
Ensure realtime is enabled for the `public.checkins` table in Supabase.

## Post-Deploy
- Verify `complete_checkin` function executes with service role.
- Test `generate_qr_token` and `validate_qr_token` via the clients.
