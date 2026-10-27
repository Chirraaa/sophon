# Third-party source availability

Sophon includes unmodified third-party packages that are transformed by the JavaScript bundler. Their licenses govern those components separately from Sophon's original code.

## ELK layout engine

Mermaid uses `elkjs` 0.9.3, licensed under EPL-2.0. Its source code, build scripts, license and upstream history are available at:

- https://github.com/kieler/elkjs/tree/0.9.3
- https://github.com/kieler/elkjs/archive/refs/tags/0.9.3.tar.gz
- https://github.com/eclipse-elk/elk

The published JavaScript package is available at https://registry.npmjs.org/elkjs/-/elkjs-0.9.3.tgz. The ELK Java engine is compiled into that package upstream. Sophon's noncommercial restriction does not apply to the EPL-covered component.

## Other components

The generated `THIRD_PARTY_NOTICES.txt` records npm package versions, repositories and supplied license texts. The lockfile records package archives and integrity digests. DOMPurify is used under its Apache-2.0 alternative; type-fest under its MIT alternative.

Whisper runtime source is pinned to https://github.com/ggml-org/whisper.cpp/tree/d1be6fde11ac6e0407606b4e42fe72d34add8037. The bundled Whisper Base weights are from https://huggingface.co/ggerganov/whisper.cpp and retain OpenAI Whisper's MIT license. Their exact SHA-256 is recorded in `src/main/voice/manifest.json`.

Electron's separate Chromium notice file must remain with distributed builds. Microsoft runtime and graphics binaries delivered by Electron retain their upstream redistribution terms.
