# Browser video compression dependencies

Vendored, unmodified npm distributions:

- `ffmpeg.js`, `814.ffmpeg.js`: `@ffmpeg/ffmpeg@0.12.15`, MIT.
- `ffmpeg-core.js`, `ffmpeg-core.wasm`: `@ffmpeg/core@0.12.10`, GPL-2.0-or-later (FFmpeg with libx264 and other codecs).
- ZIP export reuses `cocos-html-compressor/vendor/jszip.min.js`.

Sources and corresponding build recipes:

- https://github.com/ffmpegwasm/ffmpeg.wasm/tree/v12.15
- https://github.com/ffmpegwasm/ffmpeg.wasm-core
- https://github.com/ffmpegwasm/ffmpeg.wasm/tree/v0.12.10
- https://registry.npmjs.org/@ffmpeg/ffmpeg/-/ffmpeg-0.12.15.tgz
- https://registry.npmjs.org/@ffmpeg/core/-/core-0.12.10.tgz

The single-thread core runs on GitHub Pages without SharedArrayBuffer, COOP or COEP. The engine is loaded only when compression starts. Do not remove the wrapper worker or change its relative path. For updates, copy the matching unmodified UMD distribution files and retain the license notices.
