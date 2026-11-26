# Android WebView gate hotfix

Web repo C:/projects/mysession-prejoin-tile; Android source C:/projects/mysession-android-native, APK dist/MySession-Android-0.2.0-native-preview.apk. Full native architecture and limitations in Android HANDOFF.md; overall site architecture in docs/my-session-project-context.md and prejoin-tile-preview-context.md.

Production site InAppBrowserMediaGate blocked all Android wv UAs including our app. Native MainActivity already installs AndroidX MySessionNative WebMessage listener at document start for only https://mysession.club and https://www.mysession.club. Detection now exempts these HTTPS origins only when this bridge exposes postMessage function. No UA spoofing, no general WebView exemption, no auth/payment gates changed. Third-party embedded browsers without our bridge still follow original warning. Website deployment required, APK rebuild not required. No actual phone test yet; user is testing phone. No production credentials or database changes.

Verification: Vite build passed, 3 detection regression tests passed (our bridge allowed, ordinary WebView blocked, foreign origin/non-callable marker rejected). Phone runtime not independently verified.

Android OAuth companion 0.2.2: desktop-auth.js returns mysession-android://oauth/callback when platform=android; default desktop scheme unchanged. Native PKCE implementation and PiP changes are in separate Android project; see C:/projects/mysession-android-native/HANDOFF.md for full architecture, verification and device-test limitations. 13 callback/desktop/gate tests passed. No Supabase allowlist or auth settings changed.
