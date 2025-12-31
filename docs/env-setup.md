# Environment Setup

## Required Tools
- Node.js 18+
- npm
- Git
- Expo CLI
- Supabase CLI

Install Expo CLI and Supabase CLI:
```bash
npm install -g expo-cli
npm install -g supabase
```

## Create a Supabase Project
1. Go to https://supabase.com and create a new project.
2. In the project dashboard, copy:
   - **Project URL** (SUPABASE_URL)
   - **Anon key** (SUPABASE_ANON_KEY)
   - **Service Role key** (SERVICE_ROLE_KEY)

## Configure Environment Files

### Web
Create `web/.env.local`:
```bash
cp web/.env.example web/.env.local
```
Edit `web/.env.local` and set:
```
NEXT_PUBLIC_SUPABASE_URL=YOUR_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL=https://YOUR_PROJECT_REF.functions.supabase.co
```

### Mobile
Create `mobile/.env`:
```bash
cp mobile/.env.example mobile/.env
```
Edit `mobile/.env` and set:
```
EXPO_PUBLIC_SUPABASE_URL=YOUR_SUPABASE_URL
EXPO_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
EXPO_PUBLIC_SUPABASE_FUNCTIONS_URL=https://YOUR_PROJECT_REF.functions.supabase.co
```

> **Note:** Never expose `SERVICE_ROLE_KEY` to web or mobile clients. It is used only in server-side environments.

## Apply Database Schema
From the repo root:
```bash
psql "${SUPABASE_DB_URL}" -f schema.sql
```

## Deploy Edge Functions
From the repo root:
```bash
supabase functions deploy generate_qr_token
supabase functions deploy validate_qr_token
```

Set secrets for the functions:
```bash
supabase secrets set SUPABASE_URL=YOUR_SUPABASE_URL
supabase secrets set SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
```
