# Mobile Deployment (Expo EAS)

## Prereqs
- Expo account and EAS CLI installed
- Supabase project configured and Edge Functions deployed

## Environment Variables
Add to `mobile/.env` (use `.env.example` as a template):

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_SUPABASE_FUNCTIONS_URL`
- `EXPO_PUBLIC_SENTRY_DSN` (optional)

## Local Dev
```bash
cd mobile
expo start
```

## EAS Build
```bash
cd mobile
eas build --platform ios
# or
eas build --platform android
```

## EAS Updates
```bash
cd mobile
eas update --branch production --message "Release MVP"
```

## Post-Deploy
- Validate camera permissions and QR scanning.
- Confirm realtime check-in updates on staff devices.
