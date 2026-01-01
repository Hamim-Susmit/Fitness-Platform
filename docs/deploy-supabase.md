# Deploy Supabase

## 1) Apply Migrations
From the repo root:
```bash
supabase db push
```

Alternatively, apply the SQL directly:
```bash
psql "${SUPABASE_DB_URL}" -f schema.sql
```

## 2) Deploy Edge Functions
```bash
supabase functions deploy generate_qr_token
supabase functions deploy validate_qr_token
```

## 3) Set Secrets
```bash
supabase secrets set SUPABASE_URL=YOUR_SUPABASE_URL
supabase secrets set SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
```

## 4) Verify RLS and Realtime
- Confirm RLS is enabled on all tables.
- Enable realtime for `public.checkins` in the Supabase dashboard.

## 5) Validate End-to-End
- Generate a QR token from web or mobile.
- Scan as staff and confirm a new `checkins` row is created.
