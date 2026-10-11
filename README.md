# EarnZA

EarnZA is a first version of a South African “watch a rewarded ad, earn points, request Rands” app. The phone is for Mehedi’s users. The web portal is for Mehedi. Cash is paid by hand. The app never moves money and never trusts the phone to add points.

Currency is the Rand (ZAR). The operator is in South Africa.

## Stack, and why

The Android app is **Flutter**. One Dart project produces the debug APK and, later, the Play App Bundle. Flutter has first-party plugins for AdMob and Firebase, and the UI stays in one place instead of being split across XML and Kotlin for every screen.

The backend is **Firebase Authentication, Cloud Firestore, and Cloud Functions**, with one HTTPS function in front of them:

- Firebase Auth is email/password and Google sign-in, once a Firebase project exists.
- Firestore holds users, the ledger, cash-out requests, and settings. Client apps are not allowed to write any of it. The security rules deny every direct read and write.
- Cloud Functions verify AdMob’s server-side callback and are the only code that changes a balance.

Until those accounts exist, the same rules run as a local Node server with a file database. The admin site and the debug app talk to that server. Production turns demo completion off, so a phone cannot grant itself points.

## Layout

| Path | What it is |
| --- | --- |
| `mobile/` | Flutter Android app (`za.earnza.watch`) |
| `functions/` | API. `npm run dev` locally, Cloud Function `api` in production |
| `admin/` | Owner portal (Vite + React) |
| `firestore.rules` | Deny all client access |
| `firebase.json` | Functions, Hosting, Firestore |

## Run it on this machine

You need Node 22 and the Flutter SDK.

```bash
npm install --prefix functions
npm install --prefix admin
npm test
npm run dev
```

The API listens on port 8787 and prints the demo logins. In another terminal:

```bash
npm run admin
```

Open http://127.0.0.1:5173

| Who | Email | Password |
| --- | --- | --- |
| Owner portal | `mehedi@earnza.local` | `EarnZA-admin-demo` |
| Sample member | `thabo@earnza.local` | `EarnZA-user-demo` |

Other seeded members (`naledi@`, `johan@`, `aisha@`, `sipho@`, `lauren@`, all `@earnza.local`) use `EarnZA-user-demo`. Johan is flagged as an emulator. Aisha is blocked. Sipho has a pending 1Voucher request. Lauren has a pending bank transfer. These passwords are for the local demo only.

The Android app, from `mobile/`:

```bash
flutter run
```

An emulator reaches your computer at `http://10.0.2.2:8787` (the default). On a phone, set the server address on the connection screen to your computer’s LAN address, for example `http://192.168.1.20:8787`. Debug builds allow plain HTTP. Release builds do not.

## How a reward is credited

1. The app asks `POST /v1/ads/prepare`. The server checks the daily cap, the cooldown, blocks, and device flags, then returns a one-time session id. It does not add points.
2. The app plays a rewarded ad and gives AdMob that session id as server-side verification (SSV) custom data, and the user id as the SSV user id.
3. Google calls `GET /v1/admob/ssv` with a signed query string.
4. The function checks the ECDSA signature against Google’s public keys (`https://www.gstatic.com/admob/reward/verifier-keys.json`), checks the session is still open, and adds `pointsPerAd` from settings. The `reward_amount` in the callback is ignored.
5. The same `transaction_id` cannot be credited twice.

The in-app “user earned reward” callback only refreshes the balance. It cannot post a point value.

In the local demo, Google is replaced by a countdown and `POST /v1/ads/demo-complete`. That route is off when `DEMO_SSV=false` (the Cloud Function default). It still does not accept a point amount from the phone. The phone’s debug build follows the server’s `demoMode` flag: demo server, countdown; production server, a real AdMob rewarded ad.

## Money

Defaults, all editable in the portal:

| Setting | Default |
| --- | --- |
| Points per Rand | 100 (so 5 points is R0.05) |
| Points per verified ad | 5 |
| Estimated revenue per verified ad | R0.20 |
| Daily cap | 30 ads |
| Wait between ads | 60 seconds |
| Minimum cash out | 5,000 points (R50) |
| Daily check-in | 10 points |
| Referral, each side, after the friend’s first verified ad | 100 points |

A cash out creates a **PENDING** request and holds the points. Mehedi approves, rejects (points go back), or marks it paid after paying outside the app. Marking a 1Voucher paid requires the PIN. Marking a bank transfer paid requires the payment reference. The member sees the PIN or reference in the app and under the bell icon. Nothing here calls 1Voucher or a bank.

If “refuse cash outs that exceed estimated revenue” is on, a request is rejected when paid-out plus pending plus this request would pass estimated ad revenue. Estimated revenue is `verified ads × the eCPM you type`. It is not downloaded from AdMob. If that number is inflated, the warning is meaningless. The dashboard shows signups, verified ads, Rand still owed (wallets plus pending requests), Rand already paid, and estimated revenue side by side.

Day boundaries use Africa/Johannesburg.

## Fraud checks

- One account is bound to one device id (`Settings.Secure.ANDROID_ID`). A second signup on that device is rejected. In the local demo, an existing account may move to a new device so you can sign in on an emulator; production does not allow that move.
- The app reports emulator and root signals. Production refuses rewards when those switches are on. The local demo still records the flags (Johan is an example) but allows rewards, so the emulator walkthrough works.
- Balances change only inside a server transaction.
- Sign-up, sign-in, password reset, and ad preparation are rate limited. Sign-ups per IP per day are capped.
- Suspicious accounts can be blocked in the portal. A blocked account can sign in and read history, and cannot earn or cash out.

## Where the real ad IDs go

The project ships Google’s **test** ids:

- App id, in `mobile/android/app/src/main/AndroidManifest.xml`: `ca-app-pub-3940256099942544~3347511713`
- Rewarded unit, in `mobile/lib/src/config.dart`: `ca-app-pub-3940256099942544/5224354917`

Replace the manifest value with the AdMob **app** id. Pass the rewarded unit at build time:

```bash
flutter build appbundle --release \
  --dart-define=ADMOB_REWARDED_UNIT_ID=ca-app-pub-YOUR_PUBLISHER/YOUR_UNIT \
  --dart-define=USE_FIREBASE=true \
  --dart-define=GOOGLE_SERVER_CLIENT_ID=YOUR_WEB_CLIENT_ID.apps.googleusercontent.com \
  --dart-define=API_BASE=https://europe-west1-YOUR_PROJECT.cloudfunctions.net/api
```

Do not ship the test ids on a store build. AdMob can limit the account, and test impressions are not revenue.

In the AdMob console, open the rewarded unit and set the server-side verification URL to:

```text
https://europe-west1-YOUR_PROJECT.cloudfunctions.net/api/v1/admob/ssv
```

Leave the query string empty. AdMob appends the signed parameters.

## Firebase and the production API

1. Create a Firebase project. Register an Android app with package name `za.earnza.watch`.
2. Add the debug and the upload/release SHA-1 certificates. Google sign-in needs them.
3. Enable Authentication: Email/Password and Google.
4. Create a Firestore database. Deploy the rules in this repo (`allow read, write: if false`).
5. Replace `mobile/lib/src/firebase_options.dart` with the output of `flutterfire configure`, or paste the Android values from the Firebase console. The placeholder values will not sign anyone in.
6. Copy `functions/.env.example` to `functions/.env` and set `ADMIN_EMAILS` to the Google account Mehedi will use in the portal. That user must sign in with Firebase (the production API does not use the demo password).
7. Install the Firebase CLI, then from the repo root:

```bash
npm install --prefix functions
npm run build --prefix functions
firebase use --add
firebase deploy --only functions,firestore:rules
```

The function is `api` in `europe-west1`, which is the nearest generally available region to South Africa among the usual defaults. AdMob must be able to reach it with no Firebase user, so the function is public and the SSV route relies on the signature, not a login.

The admin portal in production uses Firebase email/password as well. Build it with the function URL and deploy it on Firebase Hosting:

```bash
VITE_API_BASE=https://europe-west1-YOUR_PROJECT.cloudfunctions.net/api npm run build --prefix admin
firebase deploy --only hosting
```

Hosting also serves two public drafts:

- `/privacy.html`
- `/delete-account.html`

Put those URLs in the Play Console. Replace the wording before you submit. The in-app Terms, Privacy, and Help screens carry the same “needs legal review” banner.

Local demo Google sign-in creates `demo.google@earnza.local`. Real Google sign-in runs only when the app is built with `USE_FIREBASE=true` and a web client id.

## Release App Bundle for Play

1. Create an upload keystore and do not commit it:

```bash
keytool -genkey -v -keystore upload-keystore.jks -keyalg RSA -keysize 2048 -validity 10000 -alias upload
```

2. Create `mobile/android/key.properties` (this repo ignores it):

```properties
storePassword=...
keyPassword=...
keyAlias=upload
storeFile=/absolute/path/upload-keystore.jks
```

`mobile/android/app/build.gradle.kts` already uses that file for release signing when it exists. Without it, a release build is signed with the debug key so you can try it locally. Do not upload a debug-signed bundle.
3. Build:

```bash
cd mobile
flutter build appbundle --release --dart-define=USE_FIREBASE=true --dart-define=API_BASE=https://europe-west1-YOUR_PROJECT.cloudfunctions.net/api --dart-define=ADMOB_REWARDED_UNIT_ID=ca-app-pub-YOUR_PUBLISHER/YOUR_UNIT --dart-define=GOOGLE_SERVER_CLIENT_ID=YOUR_WEB_CLIENT_ID.apps.googleusercontent.com
```

The bundle is `mobile/build/app/outputs/bundle/release/app-release.aab`.

A debug APK for sideloading is:

```bash
flutter build apk --debug
```

`mobile/build/app/outputs/flutter-apk/app-debug.apk`

## Google Play checklist for this kind of app

Policies change. Read the current Play and AdMob pages on the day you submit. This list is the practical bar for a rewards app, not a legal opinion.

- **Age.** Cash rewards and ads. Do not opt into Designed for Families. Treat the app as 18+. Say that in the store listing and in the terms.
- **Ads declaration.** Declare that the app contains ads. Use Google’s rewarded format only, and only after the person taps Watch. Do not pay people to tap normal banners or to click through to other apps. Rewarded views are the format AdMob allows you to incentivise.
- **Test ads.** The test app id and test rewarded unit must be gone before the store build. Test traffic in production is an AdMob policy problem, and it is not income.
- **Honest listing.** Do not promise an income, a job, or a fixed daily amount. Rewards are small, capped, and depend on an ad actually being available and verified. Screenshots should show the real balance screen, not a fake fortune.
- **Payments policy.** This version sells nothing. Do not sell points or bundles for money outside Google Play Billing. Paying users for watched ads is a manual rewards programme, not an in-app product. If you later sell anything digital, use Play Billing.
- **Data safety.** Declare name, email, device id, and financial info (bank account or phone number for a payout). Link a privacy policy URL. The draft at `/privacy.html` is not ready to submit.
- **Account deletion.** The app can delete an account (Profile → Delete account). Play also asks for a web link. Use `/delete-account.html`, then replace the placeholder email.
- **Target API.** Ship with Flutter’s current `targetSdk` and check it against the level Play Console requires that week.
- **Permissions.** The app asks for internet, and the ads SDK merges the advertising id. Do not add contacts, SMS, or phone-state permissions.
- **Financial features form.** A manual cash-out programme can trigger Play’s financial-features questions. Answer them as rewards paid by the operator, not as a bank, wallet, or loan.
- **Gambling.** There is no stake and no prize draw. Do not add spins, loot boxes, or “win cash” mechanics.
- **South African law.** Before launch, have the terms, the privacy notice, and the 1Voucher / EFT wording reviewed for POPIA and consumer law. The in-app legal pages are marked draft on purpose.
- **Payouts you cannot automate yet.** Only request a cash out you can actually pay. The dashboard exists so outstanding points do not quietly grow past ad revenue.

## What works, and what is still a stub

Works now, against the local server:

- Email sign-up, sign-in, forgot-password (the demo shows the reset code on screen; production Firebase sends the email).
- A demo Google button that creates a local user. Real Google sign-in is coded and runs only after Firebase is configured.
- Balance in points and Rand, daily check-in, referral code, activity, cash-out request, status history, in-app notices when a payout changes.
- Server-side caps, cooldown, device binding, emulator/root flags, rate limits, and the revenue guard.
- AdMob SSV verification (signature check, replay protection, reward amount ignored), covered by tests. The production ad-load path is in the app and uses the test unit until you replace it.
- Admin: dashboard, search, block, point adjustment with a note, approve / reject / mark paid, settings.

Not done, on purpose, until Mehedi has the accounts:

- No live Firebase project is wired in this repo. `firebase_options.dart` is a placeholder. Cloud Functions are ready to deploy.
- No automatic 1Voucher purchase and no bank EFT API. “Paid” means Mehedi recorded a PIN or a reference.
- No push notifications. The bell updates when the app refreshes (about every 15 seconds while it is open, and when you pull to refresh). Firebase Cloud Messaging can be added after the Firebase app exists.
- The eCPM is a number in settings, not a pull from the AdMob reporting API.
- Terms, privacy, and the support email are placeholders.
- Demo mode does not block emulators. The production function does, when the switch is on.

## Accounts and keys to create next

1. **Firebase** — project, Android app `za.earnza.watch`, email and Google auth, Firestore, Blaze plan if Cloud Functions outbound networking (the AdMob key fetch) requires it. Download the Android config and set `ADMIN_EMAILS`.
2. **AdMob** — app, rewarded unit, SSV URL pointed at `/v1/admob/ssv`. Keep test ids until this works, then replace them.
3. **Google Cloud OAuth** — the Web client id (`GOOGLE_SERVER_CLIENT_ID`) and the SHA-1 of the upload key, or Google sign-in will not return an ID token.
4. **Google Play Console** — app listing, data safety, ads declaration, privacy URL, account-deletion URL, content rating, and the release keystore above.
5. **Firebase Hosting** — `firebase deploy --only hosting` for the portal, privacy page, and deletion page. Any other static host works if it serves `admin/dist`.
6. **A way to pay people** — a 1Voucher float Mehedi buys himself, and a bank account for EFTs. The app does not connect to either.
7. **A real support email**, and a lawyer or compliance review before the listing goes live.
