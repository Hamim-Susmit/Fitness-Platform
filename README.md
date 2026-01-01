# Gym Membership Platform (Phase 1 MVP)

A cloud-native gym membership platform focused on Phase 1 MVP features: role-based authentication, member profiles, QR-based check-ins, visit history, and realtime staff dashboards. This repository includes the Supabase backend, a Next.js web app, and an Expo mobile app.

## MVP Scope (Phase 1)
- Supabase Auth with roles: `member`, `staff`, `owner`
- Member profile + active membership status
- QR token generation (2-minute expiry)
- Staff QR scanner + validation
- Visit history logging
- Realtime staff check-in feed

## Tech Stack
- **Web:** Next.js 14 (App Router), React 18, TypeScript, Tailwind, React Query, Zustand
- **Mobile:** Expo (React Native), TypeScript, React Navigation, React Query, Zustand
- **Backend:** Supabase Postgres + RLS + Edge Functions

## Repo Structure
- `schema.sql` — Supabase database schema + RLS policies
- `supabase/functions` — Edge Functions (`generate_qr_token`, `validate_qr_token`)
- `web/` — Next.js web app (member + staff dashboards)
- `mobile/` — Expo mobile app (member + staff dashboards)
- `docs/` — Deployment and local development guides

## Quick Start
1. **Create Supabase project** and apply the schema.
2. **Deploy Edge Functions** for token generation and validation.
3. **Configure env files** for web and mobile.
4. **Run the apps** locally.

See the docs below for step-by-step instructions.

## Documentation
- Environment setup: `docs/env-setup.md`
- Local development: `docs/local-dev.md`
- Deploy web (Vercel): `docs/deploy-web-vercel.md`
- Deploy mobile (Expo): `docs/deploy-mobile-expo.md`
- Deploy Supabase: `docs/deploy-supabase.md`
