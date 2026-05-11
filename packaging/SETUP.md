# Packaging — distribution channel setup

This file documents the **manual** steps needed before the
`release.yml` workflow can publish to Homebrew, winget, or sign macOS
bundles. The auto-update steps in the workflow assume these are done.

## macOS — code signing + notarisation

Required for the `bundle` job's mac steps to produce a signed +
notarised app. Without these secrets the workflow falls through to an
unsigned bundle (Gatekeeper warns once on first launch).

1. **Apple Developer Program** — $99/year. Sign up at
   <https://developer.apple.com>.
2. **Developer ID Application certificate** — Account → Certificates →
   `+` → "Developer ID Application". Download the `.cer`, install in
   Keychain Access, then export as `.p12` (Personal Information
   Exchange) with a password.
3. **App-specific password** for `notarytool`. Create at
   <https://appleid.apple.com> → Sign-In and Security →
   App-Specific Passwords. Label it "SPECS notarytool".
4. **Repo secrets** (Settings → Secrets and variables → Actions):
   - `APPLE_CERTIFICATE` — `base64 -i Certificates.p12 | pbcopy`
   - `APPLE_CERTIFICATE_PASSWORD` — the .p12 password from step 2
   - `APPLE_SIGNING_IDENTITY` — e.g.
     `Developer ID Application: Gordon Beeming (TEAMID)`
   - `APPLE_ID` — Apple Developer email
   - `APPLE_TEAM_ID` — 10-char Team ID from
     <https://developer.apple.com/account>
   - `APPLE_PASSWORD` — the app-specific password from step 3

## Homebrew tap

The workflow pushes an updated `Casks/specs.rb` to
`gordonbeeming/homebrew-tap` after every signed mac release. Users
install with:

```sh
brew install --cask gordonbeeming/tap/specs
```

Setup:

1. **Tap repo** — already exists at
   <https://github.com/gordonbeeming/homebrew-tap>. Used by `vista`,
   `copilot_here`, etc.
2. **Deploy key** — generate a fresh key:
   `ssh-keygen -t ed25519 -f /tmp/specs_tap_key -N "" -C "specs-release"`
3. Add `/tmp/specs_tap_key.pub` to the **tap repo's** Settings →
   Deploy keys, with **Allow write access** ticked.
4. Copy `/tmp/specs_tap_key` (the *private* key) into this repo's
   secrets as `HOMEBREW_TAP_DEPLOY_KEY`.
5. Delete both files locally.

To disable the tap update (e.g. for forks), set the
`PUBLISH_HOMEBREW` repo variable to `false`.

## winget

The workflow submits an updated manifest to `microsoft/winget-pkgs`
via `wingetcreate` after every windows release. Users install with:

```sh
winget install GordonBeeming.SPECS
```

**The first manifest submission must be manual** — `wingetcreate
update` requires the manifest to exist already. Once the first PR is
merged into `microsoft/winget-pkgs/manifests/g/GordonBeeming/SPECS/`,
all subsequent releases auto-submit.

Setup:

1. **Fork** <https://github.com/microsoft/winget-pkgs> on the GitHub
   account that will own the PAT.
2. **PAT** for that account. Two routes:
   - **Classic PAT** (simpler): scope = `public_repo`. Settings →
     Developer settings → Personal access tokens → Tokens (classic).
   - **Fine-grained PAT** (recommended): restricted to the
     `winget-pkgs` fork only, with permissions
     `Contents: Read and write` and `Pull requests: Read and write`.
     Fine-grained tokens don't accept the legacy `public_repo` scope
     name — pick the per-repo permissions instead.

   Save the resulting token as `WINGET_PAT` in this repo's secrets.
3. **First submission** — locally. Replace the URL with the actual
   MSI asset name from the v0.1.0 GitHub Release (Tauri's bundler
   keys filenames off `productName` from `tauri.conf.json` —
   currently `S.P.E.C.S` — so the asset arrives as
   `S.P.E.C.S_0.1.0_x64_en-US.msi`):
   ```sh
   wingetcreate new \
     --urls "https://github.com/GordonBeeming/SPECS/releases/download/v0.1.0/S.P.E.C.S_0.1.0_x64_en-US.msi" \
     --token $WINGET_PAT \
     --submit
   ```
   Walk through the prompts (publisher: GordonBeeming, package
   identifier: GordonBeeming.SPECS). After the resulting PR merges
   into `microsoft/winget-pkgs`, every subsequent release uses
   `wingetcreate update` automatically.
4. To disable winget updates (for forks), set `PUBLISH_WINGET`
   repo variable to `false`.

## What ships unsigned

Linux bundles (.AppImage, .deb) ship unsigned. Players run them
directly. No additional setup needed.
