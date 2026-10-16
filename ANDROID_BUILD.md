# Android Build

## Verified environment

- OpenJDK 21
- Android SDK API 36
- Android Build Tools 36.0.0
- Capacitor Android 8.4.1

The generated project targets API 36, has only the Internet permission, uses app-private storage, and contains adaptive icon and splash placeholders from Capacitor.

Verified on Linux with the `turnleaf_api36` Google APIs x86_64 emulator: install, secure credential persistence, live library browsing, native download, paginated reading, force-stop persistence, airplane-mode cached browsing, and offline CFI reopen.

## Commands

Check the local Android toolchain before starting a build. The preflight checks
`android/local.properties`, `ANDROID_HOME`, `ANDROID_SDK_ROOT`, and the usual
per-user SDK locations. It also verifies that the compile SDK (API 36) and at
least one Android Build Tools version are installed.

```bash
npm run android:doctor
```

The project-specific `android/local.properties` file is intentionally ignored
by Git because its path is machine-specific. Create it when the SDK is in a
non-standard location, or export `ANDROID_HOME` instead:

```bash
printf 'sdk.dir=%s\n' "/absolute/path/to/Android/Sdk" > android/local.properties
```

```bash
export ANDROID_HOME="$HOME/Android/Sdk"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
npm ci
npm run android:debug
```

Debug APK: `android/app/build/outputs/apk/debug/app-debug.apk`.

For release readiness:

```bash
keytool -genkeypair -v -keystore turnleaf-release.jks -alias turnleaf -keyalg RSA -keysize 4096 -validity 10000
npm run android:release
```

Configure the signing secret outside Git in `android/keystore.properties` or a CI secret before distributing the generated APK. The repo includes `android/keystore.properties.example` as a template. GitHub Actions expects these secrets:

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

The current release script produces a signed APK when those values are present and fails loudly if release signing is missing.

Device commands used:

```bash
adb devices
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell monkey -p app.turnleaf.reader 1
```

Plain HTTP is disabled by product policy until the user explicitly confirms it in onboarding. Android must permit cleartext at the manifest level because network-security XML cannot be changed per server at runtime; HTTPS remains recommended.

## Legacy WebView build

Some devices ship an Android System WebView that cannot be updated. Onyx Boox devices on Android 9
carry an Onyx-signed WebView 86, and Android rejects Google's WebView updates over it with
`INSTALL_FAILED_UPDATE_INCOMPATIBLE`. The regular build renders unstyled there, so these devices
need the legacy build:

```bash
TURNLEAF_LEGACY_WEBVIEW=1 npm run android:debug
TURNLEAF_LEGACY_WEBVIEW=1 npm run android:release
```

It targets Chrome 86. `scripts/legacy-webview-css.ts` rewrites the built CSS: it flattens cascade
layers, removes `:where()`/`:is()`, expands logical and `inset` shorthands, and adds
`aspect-ratio` and `dvh` fallbacks. `src/lib/legacy-polyfills.ts` fills in the missing runtime APIs.
Without the variable the build is unchanged.

Every GitHub release carries both variants, built from the same revision with the same app id and
signing key:

| Asset                         | For                                           |
| ----------------------------- | --------------------------------------------- |
| `app-release.apk`             | Android 7 or newer with an up-to-date WebView |
| `turnleaf-legacy-webview.apk` | WebViews stuck at Chrome 86 or older          |

Either APK installs over the other. Each build's update banner offers only its own variant.

## Release channel

The update banner checks the repository in `TURNLEAF_RELEASE_REPOSITORY` at build time, by default
`https://github.com/JorenVdV/turnleaf`. A `github.com` repository uses GitHub's API; any other
HTTPS host is treated as a Gitea server (`/api/v1/repos/<owner>/<repo>/releases/latest`). The
banner builds its release and download links from that repository URL, not from the API response.

Two workflows publish releases:

| Workflow                                | Publishes to                                       | Build numbers |
| --------------------------------------- | -------------------------------------------------- | ------------- |
| `.github/workflows/android-release.yml` | GitHub, banner checks GitHub                       | below 2000    |
| `.gitea/workflows/android-release.yml`  | `gitea.home.jorenvdv.eu`, banner checks that Gitea | 2000 + run    |

Both sign with the same key, so a Gitea build installs over a GitHub one. Gitea builds start at
build number 2000, so they also count as newer than every GitHub build. To move installed devices
over, publish one GitHub release with `TURNLEAF_RELEASE_REPOSITORY` set to the Gitea repository.
Gitea's workflow needs the same four `ANDROID_*` signing secrets as GitHub's.
