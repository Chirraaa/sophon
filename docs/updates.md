# GitHub release updates

Installed Windows builds check the public `Chirraaa/sophon` GitHub Releases feed
15 seconds after startup and every six hours. Users can also check in **Settings →
General → Updates**. Downloading and restarting are explicit user actions. Restart
is refused while a task or voice recording is active. Closing the app normally
does not silently install a downloaded update.

The updater uses NSIS installers, verifies the download checksum and the Windows
publisher signature through electron-updater, and only accepts stable releases
newer than the running version. Keep the same signing publisher across releases.
The default release build requires code signing. Do not disable signature
verification or put a GitHub token in application code, updater configuration, or
the distributed installer. Users do not need a GitHub account or access token.

## Publish a version

1. Set a new semantic version in `package.json` and `package-lock.json`, for
   example `npm version 1.1.0 --no-git-tag-version`. The release tag must match it:
   `v1.1.0` (recommended) or `1.1.0`. Never replace an existing release's binaries.
2. Prepare the pinned voice resources (`npm run setup:voice`) and configure the
   Windows signing certificate as required by electron-builder. On the signing
   machine, run `npm ci` and `npm run build:win`.
3. Create a **draft** GitHub release in `Chirraaa/sophon` for that tag. Write the
   patch notes directly in the release description using Markdown: headings,
   bulleted fixes, links, code blocks and tables are supported.
4. Upload the generated `dist/Sophon-<version>-setup.exe`, its `.blockmap`,
   and `dist/latest.yml` from the same build. Preserve artifact filenames and
   metadata exactly. `latest.yml` contains the version, download size and SHA-512
   checksum. Do not hand-edit checksums or publish metadata before its installer.
5. Publish the release with **Set as the latest release** enabled. Do not mark it
   as a prerelease. Drafts and prereleases are excluded from this stable channel.

`build:win` generates local release artifacts and never publishes automatically.
GitHub CLI or a release workflow may upload them using a maintainer's token;
that credential belongs only on the publishing machine/CI, never in the app.
The repository must be public before update checks can succeed anonymously.

### Releases without a signing certificate

The published 1.0.0 release was unsigned. When a signing certificate is unavailable,
`npm run build:win:unsigned` explicitly generates an unsigned installer and its
matching `.blockmap` and `latest.yml`; it still verifies the pinned voice resources
and never publishes automatically. Keep all three assets from the same build.
Disclose the unsigned installer in the release notes. Windows may show a
SmartScreen warning. This build does not disable the updater's signature checks:
do not promise automatic installation until an upgrade from the previous installed
release has been tested. Manual installation is the fallback if verification fails.

### Preparing 1.1.0

Release notes are in [releases/1.1.0.md](releases/1.1.0.md). The package manifests
must both report `1.1.0`, and the eventual release tag is `v1.1.0`.

Follow the branch workflow in `AGENTS.md`: commit preparation on `tech/NCS-0010`,
merge that branch into `dev`, and verify there. Wait for the maintainer's
confirmation before merging the same task branch directly into `main`.
Tag the approved commit on `main`; never tag `dev`, which may contain unrelated
integration work. Build the final assets from that approved source before uploading.

Create a draft using the reviewed notes and the exact approved commit:

```powershell
gh release create v1.1.0 --repo Chirraaa/sophon --target <approved-main-commit> --draft --title "Sophon 1.1.0" --notes-file docs/releases/1.1.0.md
gh release upload v1.1.0 dist/Sophon-1.1.0-setup.exe dist/Sophon-1.1.0-setup.exe.blockmap dist/latest.yml --repo Chirraaa/sophon
```

Review the draft, verify the actual installed upgrade, and publish as the latest
stable release when ready. Do not use `--clobber` to replace published artifacts.

## Release notes and restart behavior

Sophon fetches the exact release tag's Markdown description using the public
GitHub API, independently of the user's selected GitHub workspace account. This
fixed application release feed never searches other repositories or uses account
credentials. GitHub rate limits or unavailable notes do not prevent installation:
the dialog offers a link to the releases page if notes could not be fetched.

After a verified download, the version and release description are saved in the
app profile. The notes dialog appears after restart only if the running version
matches that downloaded version. A failed installation or an ordinary restart of
the old version cannot report update success. Dismissing the notes acknowledges
them persistently. The renderer treats descriptions as untrusted Markdown: raw
HTML is skipped and embedded images are not fetched. Links open through the app's
existing external-page flow.

Development and non-Windows builds expose the release-page link but do not
install updates. macOS/Linux distribution and signing are not configured here.

## Verification

Run `npm run smoke:updates`, `npm run typecheck`, and `npm run build` for offline
coverage. Before shipping, install a signed older build on a Windows test machine,
publish a newer signed test release with all three assets, and verify discovery,
download progress, restart, and the notes dialog. Repeat with the network cut
during download and with an active task at restart. Offline tests cannot validate
the real signing certificate, public release assets, or installer execution.
