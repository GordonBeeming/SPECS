---
name: create-release
description: Cut a new SPECS release. Use when the user says "create a release", "new release", "cut a release", or "ship it".
---

# Create Release

Create a new GitHub release for SPECS with the right tag, draft a
populated changelog, and let the release pipeline take it from there.
SPECS' workflow fires on `release.published` (see
`.github/workflows/release.yml`), so publishing the release is the
trigger — no separate tag push needed.

## Steps

1. Sync the workspace: `but clean --pull`.
2. Determine the next version by checking existing releases:
   ```bash
   gh release list --repo GordonBeeming/SPECS --limit 5
   ```
3. Bump the **minor** version. Tags are `v{major}.{minor}` — never include a patch number in the tag itself (CI stamps the build number).
4. Gather changes since the last release:
   ```bash
   LAST_TAG=$(gh release list --repo GordonBeeming/SPECS --limit 1 --json tagName --jq '.[0].tagName')
   git log ${LAST_TAG}..HEAD --oneline
   ```
   When `LAST_TAG` is empty (first release), use `git log main` instead and craft the changelog manually from PR titles.
5. Create the release. The `--target main` keeps the tag on the trunk; the body uses a heredoc so you can preview it before posting:
   ```bash
   gh release create v{major}.{minor} \
     --repo GordonBeeming/SPECS \
     --target main \
     --title "v{major}.{minor} — {short description}" \
     --notes "$(cat <<'EOF'
   # SPECS v{major}.{minor} — {short description}

   ## What's new

   - {list changes since last release using git log}

   ## Install

   **macOS** (signed + notarised):
   ```bash
   brew install --cask gordonbeeming/tap/specs
   # or
   brew upgrade --cask gordonbeeming/tap/specs
   ```

   **Windows**: `winget install GordonBeeming.SPECS` (or download the
   MSI from the assets below). The first launch may show SmartScreen
   "Unrecognised app" — "More info" → "Run anyway"; Windows code
   signing is on the v0.x roadmap, not in this build.

   **Linux**: download the AppImage or `.deb` from the assets below.

   ## Auto-update

   Existing installs will see this version surface via Tauri's
   updater — open About → "Check for updates" or wait for the next
   automatic check.
   EOF
   )"
   ```
6. **The release.published event triggers `.github/workflows/release.yml`** which automatically:
   - Builds Tauri bundles on macOS / Windows / Linux runners
   - Signs + notarises the macOS bundle with the Apple Developer ID secrets
   - Signs the updater payloads with the `TAURI_SIGNING_PRIVATE_KEY` minisign key
   - Uploads every artifact (DMG, MSI, AppImage, .deb, `.app.tar.gz`, `.sig` files) to the release
   - Generates `latest.json` (the tauri-plugin-updater manifest) and uploads it
   - Updates `gordonbeeming/homebrew-tap` cask via SSH deploy key
   - Submits the Windows manifest update to `microsoft/winget-pkgs` via `wingetcreate`
7. Watch the run:
   ```bash
   gh run watch --repo GordonBeeming/SPECS
   ```
8. When the run finishes, report the release URL + the artifact list to the user.

## Version format

- **Tags:** `v{major}.{minor}` (e.g., `v0.2`). No patch number in the tag.
- **Bundle version:** `tauri.conf.json` `version` field is the canonical patch — bump it manually when needed. CI does NOT auto-stamp the patch like vista does.
- A first release is `v0.1`; second is `v0.2`; etc.

## Important

- **Never reuse or delete existing release tags.** Tauri's updater verifies signatures against the immutable history; reusing a tag breaks update verification for installed copies.
- **Always bump the minor version for new releases.**
- **Never use `.0` patch in tags** (`v0.2`, not `v0.2.0`).
- **Don't tag from a feature branch.** Tag from `main` only — the `--target main` flag enforces this.
- **The signing keys must exist** before the first signed release:
  - `TAURI_SIGNING_PRIVATE_KEY` + `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (updater)
  - `APPLE_CERTIFICATE` + `APPLE_CERTIFICATE_PASSWORD` + `APPLE_ID` + `APPLE_PASSWORD` + `APPLE_TEAM_ID` + `APPLE_SIGNING_IDENTITY` (mac notarisation)
  - `HOMEBREW_TAP_DEPLOY_KEY` (push to the cask repo)
  - `WINGET_PAT` (winget submit)
  Missing keys are non-fatal — the relevant publisher job will skip silently and the rest of the pipeline still produces unsigned artifacts. But the macOS bundle won't notarise without the Apple set.
- **Wait for CI to finish** before telling the user to `brew upgrade` — Homebrew tap updates run after the bundle job lands, so the cask version doesn't bump until everything succeeds.
