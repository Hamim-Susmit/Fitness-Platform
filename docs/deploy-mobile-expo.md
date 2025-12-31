# Deploy Mobile App with Expo EAS

## 1) Configure EAS
```bash
cd mobile
npx expo login
npx eas build:configure
```

## 2) Set App Identifiers
Update `app.json` with your bundle identifiers:
- iOS: `ios.bundleIdentifier`
- Android: `android.package`

## 3) Build Releases
```bash
cd mobile
npx eas build --platform ios
npx eas build --platform android
```

## 4) Publish OTA Updates
```bash
cd mobile
npx eas update --branch production --message "Release MVP"
```

## 5) Verify
- Install the builds on devices.
- Verify QR scanning and realtime updates.
