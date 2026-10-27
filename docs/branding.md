# Sophon icon

The approved mark is a white **S.** on a dark charcoal tile with rounded corners.
The area outside the tile is transparent. Keep the original artwork intact when
creating other sizes; do not redraw the lettering or change its proportions.

## Source and regeneration

- `resources/sophon-icon-simple.png`: approved full-resolution source artwork.

Run `npm run icons:generate` after changing the approved source. It uses the
project's Electron dependency, so no image-conversion packages or external tools
are needed. Commit the source and regenerated assets together.
Run `npm run smoke:icons` to validate all generated sizes, format directories and RGBA encoding.

Generation trims 6% from each edge of the source's transparent border. This makes
the mark about 14% larger in the taskbar while preserving its proportions and a
small transparent margin. The original source artwork stays intact.

## Generated assets

| Asset                   | Used by                                                    |
| ----------------------- | ---------------------------------------------------------- |
| `resources/icon.png`    | Main and shortcut window icons, system tray                |
| `resources/icon-64.png` | Shared renderer `BrandIcon`, sidebar and shortcut branding |
| `build/icon.png`        | Packaging PNG and Linux icon                               |
| `build/icon.ico`        | Windows executable, installer, uninstaller and shortcuts   |
| `build/icon.icns`       | macOS application bundle                                   |

The PNG master is 1024 × 1024. The Windows ICO includes 16, 20, 24, 32, 40, 48,
64, 96, 128 and 256 pixel frames for different display scaling settings. The ICNS
includes standard and Retina representations up to 1024 pixels. All sizes retain
the artwork's transparency.

Packaging paths are explicit in `electron-builder.yml`. The app identifier and
existing profile location are kept so using this branding does not reset saved
accounts or preferences. Windows may cache existing shortcut icons; newly built
executables and installers embed the new artwork.
