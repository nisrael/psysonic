<div align="center">
  <img src="public/psysonic-inapp-logo.svg" alt="Psysonic Logo" width="300"/>

  <p><strong>A modern, gorgeous, and blazing fast desktop client for Subsonic API compatible music servers (Navidrome, Gonic, etc.).</strong></p>
  
  <p>
    <a href="https://github.com/Psychotoxical/psysonic/releases/latest"><img alt="Latest Release" src="https://img.shields.io/github/v/release/Psychotoxical/psysonic?style=flat-square&color=8839ef"></a>
    <a href="https://github.com/Psychotoxical/psysonic/blob/main/LICENSE"><img alt="License: GPL v3" src="https://img.shields.io/badge/License-GPLv3-cba6f7?style=flat-square"></a>
    <a href="https://tauri.app/"><img alt="Built with Tauri" src="https://img.shields.io/badge/Built%20with-Tauri-242938?style=flat-square&logo=tauri"></a>
    <a href="https://aur.archlinux.org/packages/psysonic"><img alt="AUR" src="https://img.shields.io/aur/version/psysonic?style=flat-square&color=1793d1"></a>
    <a href="https://aur.archlinux.org/packages/psysonic-bin"><img alt="AUR (bin)" src="https://img.shields.io/aur/version/psysonic-bin?style=flat-square&color=1793d1&label=AUR%20(bin)"></a>
    <a href="https://psysonic.cachix.org"><img alt="Cachix" src="https://img.shields.io/badge/Cachix-psysonic-5277c3?style=flat-square&logo=nixos&logoColor=white"></a>
    <a href="https://discord.gg/AMnDRErm4u"><img alt="Discord" src="https://img.shields.io/badge/Discord-Join%20us-5865F2?style=flat-square&logo=discord&logoColor=white"></a>
  </p>
</div>

> [!WARNING]
> **Psysonic is under heavy active development.** Bugs and rough edges are to be expected. We reserve the right to change, remove, or rework existing features at any time without prior notice.

---

<div align="center">
  <a href="https://discord.gg/AMnDRErm4u">
    <img src="https://img.shields.io/badge/Join%20the%20Psysonic%20Discord-%235865F2.svg?style=for-the-badge&logo=discord&logoColor=white" alt="Join Discord"/>
  </a>
  <p>Have questions, ideas, or just want to hang out? Come chat in our Discord server!</p>
</div>

---

Psysonic is a beautiful desktop music player built completely from the ground up for the modern era. Utilizing **Tauri v2** and **React**, it offers a native-feeling, lightweight, and incredibly fast experience with a stunning UI inspired by the [Catppuccin](https://github.com/catppuccin/catppuccin) and [Nord](https://www.nordtheme.com/) aesthetics.

Designed specifically for users hosting their own music via Navidrome or other Subsonic API servers, Psysonic aims to be the best way to interact with your personal library.


![Psysonic Screenshot](public/screenshot1.png)

## ✨ Features

- 🎨 **Wide Theme Selection**: Dozens of themes across 8 groups — Open Source Classics (Catppuccin, Nord, Gruvbox, Nightfox, Dracula), Operating Systems, Games, Movies, Series, Social Media, and Psysonic originals. Glassmorphism effects, micro-animations, and a time-based **Theme Scheduler** for automatic day/night switching.
- ⚡ **Native Performance**: Built with Rust & Tauri — native audio engine (rodio), minimal RAM usage, no Electron overhead.
- 🎵 **Last.fm Integration**: Scrobbling, Now Playing, love/unlove, Similar Artists, and top stats — no Navidrome config needed.
- 🎤 **Synchronized Lyrics**: Auto-scrolling synced lyrics with click-to-seek in the sidebar and fullscreen player, powered by LRCLIB and your Navidrome server.
- 📻 **Radio & Infinite Queue**: Smart Radio sessions from any song or artist, built-in Internet Radio (ICY/HLS), and an Infinite Queue that silently refills when the queue runs out.
- 🎛️ **Advanced Audio**: 10-band graphic EQ with custom presets, **AutoEQ** headphone correction, Replay Gain, gapless playback, and crossfade.
- 〰️ **10 Seekbar Styles**: Waveform, Bar, Thick Bar, Segmented, Line+Dot, Neon, Pulse Wave, Particle Trail, Liquid Fill, and Retro Tape.
- 🖥️ **Fullscreen Player**: Album art, animated synced lyrics overlay, and artist image in a dedicated fullscreen view.
- 📋 **Playlists & Library**: Full playlist management with drag-and-drop reorder and smart suggestions. Genre browsing, Random Mix, Advanced Search, ratings (1–5 stars), and multi-select actions.
- 💾 **Device Sync**: Export your library to a USB drive or portable device using a configurable filename template.
- 🖥️ **CLI Control**: Control playback, switch servers, manage the queue, and more directly from the command line.
- ⌨️ **Customization**: Configurable keybindings, UI fonts, global zoom slider, system tray, backup & restore, and in-app auto-update.
- 🌍 **8 Languages**: English, German, French, Dutch, Spanish, Chinese, Norwegian, Russian.
- 🖥️ **Cross-Platform**: Windows, macOS, and Linux (Arch AUR, .deb, .rpm, NixOS flake).
- ❄️ **NixOS / flakes**: First-class flake package with a public **Cachix** binary cache (`psysonic.cachix.org`) — `nix run github:Psychotoxical/psysonic` or add to your system config. See the [NixOS install guide](./nixos-install.md).

## 🗺️ Roadmap

### 📋 Planned
- [ ] Theme contrast & legibility audit — systematic review of text/background contrast ratios across all themes
- [ ] Accessibility (a11y) — keyboard navigation, screen reader support, ARIA labels
- [ ] More languages

---

## 📥 Installation

Navigate to the [Releases](https://github.com/Psychotoxical/psysonic/releases) page and download the installer for your operating system.

### 🐧 Linux

**Quick Install (Recommended):**
```bash
curl -fsSL https://raw.githubusercontent.com/Psychotoxical/psysonic/main/scripts/install.sh | sudo bash
```

**Manual Installation:**
- **Ubuntu / Debian**: `.deb` from GitHub Releases
- **Fedora / RHEL**: `.rpm` from GitHub Releases
- **Any distro (portable)**: `.AppImage` from GitHub Releases — `chmod +x` and run, no install required

**❄️ NixOS (flakes):**
- `nix run github:Psychotoxical/psysonic` — one-shot launch
- Full guide: [`nixos-install.md`](./nixos-install.md) *(contributed by [@cucadmuh](https://github.com/cucadmuh), PR [#209](https://github.com/Psychotoxical/psysonic/pull/209))*

### 🍎 macOS

- **macOS**: `.dmg` (Universal or Apple Silicon) — **signed with an Apple Developer ID and notarized by Apple**. Gatekeeper opens it with a single click, no `xattr` workaround required.

> [!NOTE]
> Since **v1.40.0**, macOS builds include an in-app auto-updater: click **Install now** in the update notification and the signed `.app.tar.gz` is fetched, verified against the bundled minisign public key, replaced in place, and the app relaunches — all in one step.

### 🪟 Windows

- **Windows**: `.exe` (NSIS installer)

> [!WARNING]
> **SmartScreen Note:**
> Windows SmartScreen might show a warning because the installer isn't signed with an expensive developer certificate. Click on **"More info"** and then **"Run anyway"**.

## 📦 Installation (Arch Linux / AUR)

Psysonic is available in the **AUR** in two versions. Choose the one that best fits your needs:

| Package | Type | Description |
| :--- | :--- | :--- |
| [**psysonic**](https://aur.archlinux.org/packages/psysonic) | **Source** | Builds from source using your system's native **WebKitGTK** (no bundled libs, no EGL/Mesa compatibility issues). |
| [**psysonic-bin**](https://aur.archlinux.org/packages/psysonic-bin) | **Binary** | Pre-compiled version for faster installation. |

> [!TIP]
> The AUR binary package is kindly provided and maintained by [**kilyabin**](https://github.com/kilyabin).

## 🚀 Getting Started

1. Download and install Psysonic.
2. Open the app and enter your Subsonic/Navidrome server details (URL, Username, Password).
3. If applicable, you can provide both an external URL and a local LAN IP. Psysonic allows you to quickly toggle between them in the Settings.
4. Enjoy your music!

## 🛠️ Development

If you want to build Psysonic from source or contribute to the project:

### Prerequisites
- [Node.js](https://nodejs.org/) (v18+)
- [Rust](https://www.rust-lang.org/) (v1.75+)
- **`cmake`** — required to compile the bundled libopus (Opus audio support). Install it before running `cargo build` or `npm run tauri:build`:
  - Linux: `sudo apt install cmake` / `sudo pacman -S cmake`
  - macOS: `brew install cmake`
  - Windows: [cmake.org/download](https://cmake.org/download/) or `winget install cmake`
- OS-specific build dependencies for Tauri (see the [Tauri prerequisites guide](https://tauri.app/v2/guides/getting-started/prerequisites)).

### Setup

```bash
# Clone the repository
git clone https://github.com/Psychotoxical/psysonic.git
cd psysonic

# Install node dependencies
npm install

# Run in development mode
npm run tauri:dev

# Build for production
npm run tauri:build
```

## 🤝 Contributing

Contributions are completely welcome! Whether it is translating the app into a new language, fixing a bug, or proposing a new feature.

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

Distributed under the **GNU General Public License v3.0**. See `LICENSE` for more information.

This means: you are free to use, study, and modify Psysonic. If you distribute a modified version, you must release it under the same GPL v3 license and keep the original copyright notice intact. You may **not** incorporate this code into proprietary software.

## 🔒 Privacy

Psysonic contains no telemetry or analytics. All third-party integrations (Last.fm, LRCLIB, Discord) are opt-in. See [PRIVACY.md](PRIVACY.md) for full details.
