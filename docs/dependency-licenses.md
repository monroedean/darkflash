# Dependency license review

Darkflash's direct dependencies were selected for compatibility with an MIT-licensed open-source release. No source code or assets were copied from Twinkle Tray, Philips Hue Sync, or another product.

| Dependency | Purpose | Version | License | Distributed at runtime |
| --- | --- | --- | --- | --- |
| Electron | Windows tray, settings UI, screen thumbnails | 43.4.1 | MIT | Yes |
| Koffi | Node-API FFI for documented Win32 monitor APIs | 3.1.6 | MIT | Yes |
| Electron Packager | Cross-platform unpacked build | 20.3.0 | BSD-2-Clause | No |
| TypeScript | Compilation and static checking | 7.0.2 | Apache-2.0 | No |
| Vitest | Deterministic test runner | 4.1.11 | MIT | No |

The packaged Electron distribution and runtime packages retain their upstream license files. Transitive dependency licenses remain recorded in their package metadata and lockfile. Re-check this table and the full dependency tree before a dependency upgrade or binary release.
