# 📖 ClipToManual: YouTube to Software Manual Studio & Course Library

> **ClipToManual** is an AI-powered documentation and technical manual synthesizer built with TypeScript and strictly governed by **Oxlint Anti-Slop** guardrails. It converts fast-paced, unstructured YouTube tutorial videos and playlists into crystal-clear, step-by-step Software User Manuals with HD video thumbnails and clickable timestamps.

---

## 🌟 Key Features (ฟีเจอร์เด่น)

### 1. 🎥 YouTube & Playlist Extractor
- **Direct YouTube URL Processing:** Extracts transcripts & timed segments automatically from YouTube watch URLs, Shorts, and Playlists.
- **Batch Playlist Processing (8+ Episodes):** Automatically extracts and compiles entire course playlists into individual chapter manuals and a Master Manual.
- **Custom Subtitle Upload:** Supports direct upload or pasting of WebVTT (`.vtt`), SubRip (`.srt`), and raw text transcripts.
- **Resilient Portable Engine:** Auto-detects system and local `yt-dlp.exe` with fallback to native fetchers.

### 2. 📚 Visual Course Library & HD Thumbnails
- **Cover Thumbnails:** Automatically extracts HD video thumbnails from YouTube clips.
- **Categorized Course Tabs:** Groups manuals by topic and course (e.g. `KruBank Farm Studio`, `TypeScript`, etc.).
- **Instant Search:** Real-time search bar across all titles and topics.
- **Expand on Click & Collapse:** Clean reading view that expands when clicking **"📖 เปิดอ่าน"** and closes cleanly.

### 3. 🧠 Structured AI Manual Synthesizer
- **Overview & Capabilities:** Summarizes the program's core purpose, target audience, and key capabilities.
- **Feature Breakdown Matrix:** Tabulates all features with detailed descriptions and practical purposes.
- **Step-by-Step Guide with Action Types:** Generates numbered steps categorized by workflow phases (Click, Input, Navigate, Configure, Export).
- **⏱️ Clickable Timestamps:** Every step links directly to the exact second in the original YouTube video.
- **⌨️ Shortcuts & Settings:** Automatically extracts hotkeys and shell commands demonstrated in the video.
- **⚠️ Tips, Warnings & Gotchas:** Highlights traps, warnings, and best practices mentioned by the instructor.
- **❓ FAQ Section:** Collapsible frequently asked questions.

### 4. 🛡️ Anti-Slop Quality Gate & Portability
- Built with 100% strict TypeScript types (zero `any`, zero unjustified type assertions).
- Real-time linting with **Oxlint**.
- **1-Click Smart Launcher (`start.bat`):** Auto-installs missing dependencies, downloads `yt-dlp.exe`, clears port 3100, and boots server seamlessly on any machine.

---

## 🚀 Quick Start (เริ่มต้นใช้งาน)

### 1-Click Launch (Windows)
Double-click [**`start.bat`**](./start.bat) to start everything automatically.

### Manual Launch
```bash
npm install
npm run dev
```
Open your browser at: **`http://localhost:3100`**

### Quality Gate & Tests
```bash
npm run check    # Strict Oxlint + Typecheck
npm test         # Automated test suite (7/7 tests)
```

---

## 🏢 🔄 Working Across Office & Home (การสลับทำงานที่บ้านและที่ทำงาน)

Read the complete step-by-step guide on how to clone, install, commit, and pull work seamlessly across computers without starting over:
👉 [**Multi-Machine Sync Guide (docs/PORTABLE_WORK_HOME_SYNC.md)**](./docs/PORTABLE_WORK_HOME_SYNC.md)

---

## 📁 Project Structure (โครงสร้างโปรเจกต์)

```text
clip-to-manual/
├── src/
│   ├── types/
│   │   └── manual.ts               # Strict TypeScript data models
│   ├── extractors/
│   │   ├── youtube-url.ts          # URL parser and timestamp math
│   │   ├── transcript-extractor.ts # TimedText, VTT & SRT parser
│   │   ├── yt-dlp-extractor.ts     # Resilient yt-dlp extractor
│   │   └── playlist-processor.ts   # Batch playlist extractor
│   ├── generators/
│   │   ├── prompt-templates.ts     # Bilingual technical writer AI prompts
│   │   ├── ai-manual-generator.ts  # Gemini AI + Local synthesis fallback
│   │   └── markdown-formatter.ts   # Rich Markdown formatter
│   ├── server/
│   │   └── web-server.ts           # Visual Card Library, Dashboard & API
│   ├── test-runner.ts              # Automated test suite
│   ├── generate-single.ts          # CLI single-video generator
│   ├── process-playlist.ts         # CLI batch playlist generator
│   └── index.ts                    # Application bootstrap
├── manuals/                        # Saved Markdown manuals library
├── docs/
│   └── PORTABLE_WORK_HOME_SYNC.md  # Multi-machine sync & setup guide
├── .gemini/skills/handoff/         # Matt Pocock Handoff skill definition
├── start.bat                       # 1-Click portable launcher & self-healer
├── .oxlintrc.json                  # Anti-Slop linter configuration
├── tsconfig.json                   # Strict TypeScript configuration
├── AGENTS.md                       # AI quality gate guidelines
└── package.json
```

---

## 📜 License
MIT License
