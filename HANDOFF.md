# 🤝 Project Handoff Document: ClipToManual

> **Generated on:** 2026-08-21  
> **Project Name:** `clip-to-manual`  
> **Repository Path:** `D:\Projects\clip-to-manual`  
> **Governed By:** Oxlint & TypeScript Strict Anti-Slop Quality Gate  

---

## 📌 1. Executive Summary (ภาพรวมโครงการ)

**ClipToManual** คือระบบสร้าง **"คู่มือการใช้งานซอฟต์แวร์และข้อกำหนดทางเทคนิค (Software User Manual & Technical Spec)"** อัตโนมัติจากคลิปหรือเพลย์ลิสต์ YouTube โดยแก้ปัญหาผู้ใช้ลืมขั้นตอนการทำงานหลังจากดูคลิปสอนที่พูดเร็วหรืออธิบายไม่เป็นระเบียบ

ระบบจะสกัดซับไตเติล/บทบรรยายผ่าน `yt-dlp` และใช้ AI (Google Gemini 2.5 Flash) สังเคราะห์เนื้อหาออกมาเป็นคู่มือทีละ Step (1-2-3), ตารางฟังก์ชันทั้งหมด, คีย์ลัด, ข้อควรระวัง (Gotchas & Warnings), คำถามที่พบบ่อย (FAQ), พร้อม **ปุ่ม Timestamp ลิงก์ตรงกลับไปจุดในวิดีโอ**

---

## 🏗️ 2. System Architecture & Tech Stack (สถาปัตยกรรมระบบ)

| ส่วนประกอบ | เทคโนโลยีที่ใช้ | หน้าที่การทำงาน |
|---|---|---|
| **Runtime & Language** | Node.js (v22.x) + TypeScript 5.7+ | Backend & Type-safe Core Architecture (Strict mode, Zero `any`) |
| **Linter & Quality Gate** | Oxlint (Rust-based) + `tsc --noEmit` | ตรวจสอบคุณภาพโค้ดระดับ Hard Gate ผ่านคำสั่ง `npm run check` |
| **Media Extractor** | `yt-dlp` (Portable + System PATH) | ดึง Metadata, Chapters, และ Auto-Subtitles (`.vtt`) อย่างแม่นยำ |
| **Fallback Extractor** | Native YouTube TimedText Fetcher | ดึงซับไตเติลตรงผ่าน HTTP เมื่อไม่มี `yt-dlp` ในระบบ |
| **AI Synthesizer** | Google Gemini 2.5 Flash / Pro API | สกัดและเรียบเรียงคู่มือภาษาไทย/อังกฤษตาม Structured JSON Schema |
| **Local Fallback Engine** | Deterministic Heuristic Synthesizer | สร้างโครงร่างคู่มือได้ทันทีแม้ไม่ได้ต่อเน็ตหรือไม่มี API Key |
| **Web Server & UI** | Native Node `http` + Tailwind CSS CDN | Dashboard แสดงสถานะ Quota, Masked API Key, คลังคู่มือ, และตัวแปลงผลลัพธ์ |
| **Portable Launcher** | `start.bat` | ตรวจและติดตั้ง Dependencies/yt-dlp/พอร์ตค้างอัตโนมัติใน 1 คลิก |

---

## 📁 3. Key Files Map (แผนที่ไฟล์สำคัญ)

```text
D:\Projects\clip-to-manual/
├── src/
│   ├── types/
│   │   └── manual.ts               # Strict TypeScript data models
│   ├── extractors/
│   │   ├── youtube-url.ts          # URL parser, timestamp math, regex guards
│   │   ├── transcript-extractor.ts # TimedText XML, VTT, SRT parser
│   │   └── yt-dlp-extractor.ts     # Dual-mode yt-dlp extractor (Local + PATH)
│   ├── generators/
│   │   ├── prompt-templates.ts     # Bilingual structured system/user prompts
│   │   ├── ai-manual-generator.ts  # Gemini API caller + Local fallback engine
│   │   └── markdown-formatter.ts   # Formatter to GitHub-flavored Markdown
│   ├── server/
│   │   └── web-server.ts           # REST API endpoints + Dashboard Web UI
│   ├── test-runner.ts              # Automated test suite (7/7 tests passing)
│   └── index.ts                    # Server bootstrap & process.loadEnvFile()
├── manuals/                        # Folder storing auto-saved generated manuals (.md)
├── .gemini/skills/handoff/         # Matt Pocock Handoff skill definition
├── start.bat                       # 1-Click portable launcher & self-healer
├── .oxlintrc.json                  # Anti-Slop linter rules
├── tsconfig.json                   # Strict TypeScript compiler options
├── AGENTS.md                       # Anti-Slop AI rules & Quality Gate
├── ref.txt                         # Knowledge base & live stream best practices
├── .env.example                    # Environment template
└── package.json                    # Scripts & dependencies
```

---

## 🧪 4. Quality Status & Verification (สถานะการตรวจสอบ)

ทุกคำสั่งผ่านการทดสอบ 100% เรียบร้อยแล้ว:
```bash
# 1. รัน Quality Gate (Oxlint + Typecheck)
npm run check
# Output: Found 0 warnings and 0 errors.

# 2. รัน Test Suite ทั้งหมด
npm test
# Output: Tests Passed: 7, Tests Failed: 0
```

---

## 🔐 5. Security & Redaction (ความปลอดภัย)

- **API Key Configuration:** เก็บในไฟล์ `.env` (ระบุใน `.gitignore` เรียบร้อย ไม่มีการ push ขึ้น git)
  ```env
  GEMINI_API_KEY=[REDACTED]
  PORT=3100
  ```
- **Dashboard Masking:** หน้าเว็บจะ Mask API Key อัตโนมัติ เช่น `AIzaSy••••••••4xK9`

---

## 💼 6. How to Run on Work Machine (วิธีนำไปเปิดต่อที่ทำงาน)

1. ก๊อปปี้โฟลเดอร์ `clip-to-manual` ทั้งหมดไปยังคอมพิวเตอร์ที่ทำงาน
2. ดับเบิลคลิกไฟล์ **`start.bat`** (สคริปต์จะตรวจสอบ Node.js, ติดตั้ง `node_modules` ที่ขาด, ดาวน์โหลด `yt-dlp.exe` ให้เอง, เคลียร์ Port 3100 และเปิดหน้าเว็บที่ `http://localhost:3100` ให้ทันที)
3. หากมี Gemini API Key ฟรี สามารถใส่ในไฟล์ `.env` หรือพิมพ์ในหน้าเว็บที่ปุ่ม "⚙️ ตั้งค่า"

---

## 🎯 7. Next Steps / Future Enhancements (สิ่งที่สามารถต่อยอดได้)

1. **Multi-Video Playlist Batch Synthesizer:** รวมบทเรียนทั้ง Playlist 20–30 ตอน ให้เป็นคู่มือเล่มเดียวแบบแบ่ง Chapters
2. **Local Whisper Speech-to-Text Fallback:** เพิ่มการถอดเสียงสำหรับวิดีโอที่ไม่มี Subtitle โดยใช้โมเดล Whisper ผ่าน CUDA บนการ์ดจอ GTX 1050 Ti
3. **Export to PDF / Notion API Integration:** เพิ่มปุ่มคลิกเดียวส่งคู่มือเข้า Notion Workspace ของผู้ใช้โดยตรง

---

*Handoff document prepared following Matt Pocock's Handoff Specification.*
