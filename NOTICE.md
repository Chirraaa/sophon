# Licensing and attribution

Original Sophon project material is offered under the [PolyForm Noncommercial License 1.0.0](LICENSE).

Third-party libraries, copied UI component code, fonts, native dependencies and model weights retain their own licenses. Sophon's noncommercial restriction does not replace or narrow the rights granted for those components. See [third-party notices](THIRD_PARTY_NOTICES.txt) and [source availability](legal/SOURCE_AVAILABILITY.md).

KaTeX JavaScript is MIT licensed; its bundled fonts are licensed under SIL OFL-1.1. Geist is also SIL OFL-1.1. Font license texts and reserved-name notices are preserved in the generated notices.

Whisper Base and whisper.cpp are MIT licensed. Electron's license and Chromium's third-party notices accompany the installer separately.

Names of external providers describe optional integrations and do not imply sponsorship or endorsement. No third-party plugin packages are bundled.

Run `npm run licenses:generate` after installing dependencies or changing bundled imports. Production builds regenerate these notices; `npm run licenses:check` checks that they match the installed, locked dependencies. New third-party code, fonts, models or native binaries need a separate provenance review.
