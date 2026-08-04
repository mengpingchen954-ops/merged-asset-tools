# WebP encoder

Vendored from `@jsquash/webp` 1.5.0, which packages the libwebp encoder from
the Squoosh project for browser use.

- Source: https://www.npmjs.com/package/@jsquash/webp/v/1.5.0
- Package license: Apache-2.0 (`LICENSE`)
- Codec license: BSD-style libwebp license (`LICENSE.codec.md`)

Only the baseline and SIMD encoder glue plus their matching WASM binaries are
included. Decoder files are intentionally omitted.
