# Local Development Guide

## Web App
```bash
cd web
npm install
npm run dev
```

Open http://localhost:3000 and log in using a seeded user.

Test flow:
- Member login → `/member` dashboard
- Staff login → `/staff` dashboard
- Generate QR token and scan it in staff dashboard

## Mobile App
```bash
cd mobile
npm install
npx expo start
```

Run on device or simulator:
- Press `a` for Android emulator
- Press `i` for iOS simulator
- Scan QR codes using a real device camera

Test flow:
- Member login → QR token dashboard
- Staff login → scanner + realtime check-ins
