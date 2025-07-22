# NetChat

Built with ❤️ by **Kixdev**

> **Two‑way LAN messenger** - operator console & lightweight client for internet‑less environments such as gaming cafés, school labs, and factory floors.



    

> **Status**: Early Alpha - we welcome pull‑requests, issues, and ideas ✨

---

## ✨ Key Features

| Operator                                                 | Client                                                            |
| -------------------------------------------------------- | ----------------------------------------------------------------- |
| 🖥️ Modern Electron UI (dark/light)                      | 🖥️ Ultra‑light tray app (Electron)                                |
| 📢 Broadcast & direct message per PC                     | 🔔 Floating notifications w/ custom sound                         |
| 📊 SQLite chat history w/ auto date‑separator            | 💡 Cannot be closed, notifies on forced shutdown                  |
| 🛑 Instant alert on client shutdown (red banner + siren) | 🎨 Theme switch & asset folder for user sounds                    |
| 📁 Configurable IP range & static mapping                | 🚀 Auto‑start via shortcut or task‐scheduler                      |
|                                                          | ✉️ Sends messages **only to Operator** (no client‑to‑client chat) |

Shared core handles TCP protocol, emoji markup, and binary packet framing.

---

## 🗺️ Project Structure

```
NetChat/
├── client/            # End‑user tray app
│   ├── assets/        # icons/, sounds/
│   ├── index.html │ main.js │ renderer.js │ preload.js
│   ├── style.css
│   ├── config.sample.json  # ← copy → config.json (git‑ignored)
│   └── package.json
├── operator/          # Supervisor console
│   ├── assets/
│   ├── main.js │ renderer.js │ preload.js │ db.js
│   ├── style.css │ index.html │ notification.html
│   ├── config.sample.json
│   └── package.json
├── core/              # Shared helpers (protocol.js, utils.js)
├── .github/workflows/ # CI pipelines
├── CHANGELOG.md
├── LICENSE            # MIT
└── README.md          # You are here
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js >= 20** (includes npm)
- Git
- Windows 10/11, macOS, or Linux (tested on Ubuntu 22.04)

### 1. Clone & Install

```bash
git clone https://github.com/<USERNAME>/NetChat.git
cd NetChat
# Operator
cd operator && npm ci && npm start &
# Client (run in another terminal or machine)
cd ../client && npm ci && npm start
```

### 2. Configuration

1. Copy the sample file and adjust IP range / sounds.
   ```bash
   cp operator/config.sample.json operator/config.json
   cp client/config.sample.json   client/config.json
   ```
2. All paths inside configs are relative to each app’s directory so they stay portable.

> **Important:** Each **client PC** (including PXE‑boot images) must open `client/config.json` and set the `"server_ip"` field to the **static IP address of the machine running NetChat‑Operator** (e.g. `"192.168.40.1"`). Keep `"server_port"` at `35444` unless you also changed it in `operator/config.json`.
>
> There should be **exactly one Operator instance** running on the network. Every client points to that single Operator via the IP above.

### 3. Building Portable Executables

Both apps use **electron‑builder**.

```bash
# Operator
cd operator
npm run build   # → dist/NetChat‑Operator‑Setup.exe

# Client
cd ../client
npm run build   # → dist/NetChat‑Client‑x64.exe
```

### 4. Deployment on CCBoot / iCafeCloud

Both **CCBoot** and **iCafeCloud** expect NetChat to reside in a *shared application folder* so disk‑less clients can reach it. **Use the exact path below (or adjust the drive letter to match your setup):**

```text
D:\Apps\Aplikasi Chat\
   ├── NetChat-Client.exe
   └── NetChat-Operator.exe
```

1. **Client** – copy or symlink the portable build (`dist/NetChat-Client-*.exe`) into the folder above on the *master image*. Add a shortcut in `Shell:Startup` or a Task‑Scheduler job so it launches on every boot.
2. **Operator** – install `dist/NetChat-Operator-Setup.exe` (or copy the portable build) to the *same* directory on the operator PC.
3. For *development* mode (`npm start`) you may simply copy the entire `client/` directory into `D:\Apps\Aplikasi Chat\` and create a shortcut to `npm start`.

### 5. Database

`operator/netchat.db` is created automatically on first launch (SQLite WAL).  It stores chat messages, timestamps, PC mapping, and shutdown events.  Backup is as simple as copying the file.

---

## 🤝 Contributing

1. Fork → create a feature branch → commit using **Conventional Commits** (e.g. `feat: add emoji picker`).
2. Run `npm run lint` on both sub‑projects.
3. Submit a Pull Request. The CI must pass.
4. All code is formatted with **Prettier**; hooks auto‑run via Husky.

See `CONTRIBUTING.md` for the full guide.

---

## 📜 License

© 2025 **Kixdev**. Distributed under the **MIT License** — free to use, modify, and distribute, provided that this copyright notice and the license text appear in all copies.

> NetChat bundles third‑party components whose licenses continue to apply:
> - **Electron** — MIT License
> - **better‑sqlite3** — MIT License
> - **bootstrap-icons** — MIT License
>
> See `NOTICE.md` for the full list.

Commercial use is allowed, but **please do not remove the shutdown alerts or attribution banners by default**, so operators remain aware of client activity.

---

## 🗒️ Changelog

All notable changes are documented in [**CHANGELOG.md**](CHANGELOG.md) and follow [*Keep a Changelog*](https://keepachangelog.com/) format and **Semantic Versioning**.

---

## 🙏 Acknowledgements

- [Electron](https://electronjs.org)
- [Node.js](https://nodejs.org)
- [better‑sqlite3](https://github.com/WiseLibs/better-sqlite3)
- [lucide‑react](https://github.com/lucide-icons/lucide)
- **DyGaming Warnet** – first live‑test site, thanks for invaluable feedback. [Instagram](https://www.instagram.com/dygamingbatam/)
- The broader local Warnet community for stress‑testing the broadcast feature.

