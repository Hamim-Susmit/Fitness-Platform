# Deploy Web App to Vercel

## 1) Connect the Repo
- Push the repo to GitHub.
- In Vercel, create a new project and import the repo.
- Set **Root Directory** to `web`.

## 2) Environment Variables
Set these in Vercel Project Settings:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL`
- `NEXT_PUBLIC_SENTRY_DSN` (optional)

## 3) Deploy
Vercel will run the default Next.js build automatically.

## 4) Verify
- Log in as a member and generate a QR token.
- Log in as staff and confirm realtime check-ins update.
