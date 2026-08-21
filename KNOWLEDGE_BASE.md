# 🧠 ClipToManual — Engineering Knowledge Base & Decision Records

> **Project:** ClipToManual (YouTube to Software Manual Generator & Studio)  
> **Repository:** `https://github.com/thanonhari/clip-to-manual`  
> **Target Audience:** Autonomous Agents, Lead Engineers & System Operators  
> **Last Updated:** 2026-08-21  

---

## 📌 สารบัญ (Table of Contents)
1. [บันทึกประวัติคำถาม & คำตอบเชิงสถาปัตยกรรม (Q&A History)](#1-บันทึกประวัติคำถาม--คำตอบเชิงสถาปัตยกรรม-qa-history)
2. [บันทึกประวัติข้อผิดพลาดและวิธีแก้เชิงลึก (Error Log & Root Cause Analysis)](#2-บันทึกประวัติข้อผิดพลาดและวิธีแก้เชิงลึก-error-log--root-cause-analysis)
3. [ตารางศัพท์ UI/UX และผัง Component (UI Component Dictionary)](#3-ตารางศัพท์-uiux-และผัง-component-ui-component-dictionary)
4. [โครงสร้างระบบและการตั้งค่าเซิร์ฟเวอร์ (System Specs & Configurations)](#4-โครงสร้างระบบและการตั้งค่าเซิร์ฟเวอร์-system-specs--configurations)
5. [กฎเหล็กการพัฒนาสำหรับ AI ในอนาคต (Guiding Principles)](#5-กฎเหล็กการพัฒนาสำหรับ-ai-ในอนาคต-guiding-principles)

---

## 1. บันทึกประวัติคำถาม & คำตอบเชิงสถาปัตยกรรม (Q&A History)

### ❓ คำถามที่ 1: ทำไมต้องแยกไฟล์ Client-side JavaScript ออกเป็น `app.js` แทนการเขียนรวมใน `web-server.ts`?
* **คำตอบ & เหตุผล:**
  * การเขียน JavaScript ฝั่งเบราว์เซอร์ไว้ใน Template Literal (`` `...` ``) ของ TypeScript ใน Backend ทำให้เกิดปัญหาตัวอักขระหลุด (Unescaped Backticks / `\n` / Single Quotes)
  * เมื่อแยกเป็นไฟล์ `src/server/public/app.js` อิสระ ทำให้:
    1. Oxlint และ TypeScript สามารถตรวจไวยากรณ์ (Syntax Checking) ได้ 100%
    2. เบราว์เซอร์สามารถดาวน์โหลดและแคชไฟล์ได้อย่างมีประสิทธิภาพ
    3. หมดปัญหาเรื่อง String Interpolation และ Regex Escaping ถาวร

### ❓ คำถามที่ 2: ทำไมเวลามีข้อผิดพลาด เราถึงต้องบันทึกไว้ และควรทำตั้งแต่วันแรกของโปรเจกต์หรือไม่?
* **คำตอบ & เหตุผล:**
  * **ควรทำตั้งแต่วันแรก (Day 1 Grounding):** การบันทึกช่วยป้องกัน "หนี้ความรู้ (Knowledge Debt)" และป้องกันภาวะความจำเสื่อม (Amnesia) ของทั้งคนและ AI
  * ช่วยให้การรันงานในอนาคตไม่ต้องเริ่มต้นค้นคว้าใหม่จากศูนย์ และใช้เป็น **Single Source of Truth (SSOT)** ประจำโปรเจกต์

### ❓ คำถามที่ 3: ควรใช้ Text File (.txt), Markdown (.md) หรือ Database ในการบันทึกข้อมูล?
* **คำตอบ & เหตุผล:**
  * **Markdown (`.md`):** ดีที่สุดสำหรับคู่มือ, กฎระบบ, และสรุปการแก้ปัญหา เพราะมนุษย์อ่านสบายตา, ฝังใน Git ได้, และ AI อ่านทำความเข้าใจได้มีประสิทธิภาพสูงสุด
  * **JSONL / Logs:** ใช้สำหรับบันทึก Event การทำงานแบบวินาทีต่อวินาที
  * **Database (SQLite/PostgreSQL):** ใช้เมื่อมีปริมาณข้อมูลมากกว่าหมื่นแถวและต้องการสืบค้นแบบ Relational Query

---

## 2. บันทึกประวัติข้อผิดพลาดและวิธีแก้เชิงลึก (Error Log & Root Cause Analysis)

### 🔴 Error 1: `Uncaught SyntaxError: Invalid or unexpected token` บนหน้าเบราว์เซอร์
* **อาการ:** หน้าเว็บโหลดขึ้นมา แต่ปุ่มกดไม่ทำงาน (เช่น กด "ลองคลิปตัวอย่าง" หรือ "สร้างคู่มือ" แล้วเงียบ)
* **สาเหตุ (Root Cause):** สคริปต์ JavaScript ใน HTML Template String มีคำสั่ง `mdText.split('\n')` และ Single Quotes ใน HTML Snippets ซึ่ง Node.js แตก `\n` ออกเป็นบรรทัดใหม่ ทำให้ไวยากรณ์ JS เสียหาย
* **การแก้ไขถาวร (Permanent Fix):** 
  * แยกโค้ดออกเป็น `src/server/public/app.js`
  * ให้ Backend ส่งไฟล์ผ่าน Route `GET /app.js`
  * ตรวจสอบความถูกต้องด้วย `node -c src/server/public/app.js`

---

### 🔴 Error 2: `Gemini API error (404): models/gemini-2.5-flash is no longer available to new users`
* **อาการ:** ระบบไม่สามารถใช้ AI สรุปคู่มือได้ และถอยไปใช้โหมด Local Deterministic Synthesis (ทำให้คลิปตัวอย่างกลายเป็นเนื้อเพลง Crazy Frog)
* **สาเหตุ (Root Cause):** Google AI Studio อัปเดต Endpoint โมเดลของปี 2026 โดยเปลี่ยนเป็น `gemini-flash-latest` และ `gemini-3.5-flash`
* **การแก้ไขถาวร (Permanent Fix):** 
  * เขียน **Multi-Model Auto-Fallback Array** ใน `src/generators/ai-manual-generator.ts`:
    ```typescript
    const candidateModels = [
      'gemini-flash-latest',
      'gemini-3.5-flash',
      'gemini-2.5-flash',
      'gemini-pro-latest'
    ];
    ```
  * ใส่ `GEMINI_API_KEY` ตัวจริงไว้ใน `.env`

---

### 🔴 Error 3: ข้อความ `Kind: captions Language: en-US` ปรากฏในคู่มือ
* **อาการ:** ขั้นตอน Step 1 มีข้อความหัวไฟล์ Subtitle ติดมาด้วย
* **สาเหตุ (Root Cause):** ตัวแปลง Subtitle VTT ไม่ได้กรอง Metadata Header บรรทัดแรกของ YouTube
* **การแก้ไขถาวร (Permanent Fix):** 
  * เพิ่ม Filter ใน `src/extractors/transcript-extractor.ts`:
    ```typescript
    const isMetadata = 
      trimmed.startsWith('WEBVTT') || 
      trimmed.startsWith('Kind:') || 
      trimmed.startsWith('Language:') || 
      trimmed.startsWith('NOTE') || 
      trimmed.startsWith('STYLE') || 
      /^\d+$/.test(trimmed);
    ```

---

### 🔴 Error 4: YouTube Subtitle Error (429 Rate Limit)
* **อาการ:** ดึงซับไตเติลไม่สำเร็จเนื่องจากโดนบล็อกคำขอ
* **สาเหตุ (Root Cause):** `yt-dlp` ร้องขอซับไตเติลทุกภาษา (100+ tracks) พร้อมกัน
* **การแก้ไขถาวร (Permanent Fix):**
  * จำกัด Scope ภาษาในการดึงให้เหลือเฉพาะ `th,th-TH,th-orig,en,en-US,en-orig`

---

## 3. ตารางศัพท์ UI/UX และผัง Component (UI Component Dictionary)

| ป้ายกำกับบนหน้าจอ (Tag Name) | ชื่อเรียกทางคอมพิวเตอร์ | หน้าที่การทำงาน |
|---|---|---|
| 🏷️ `[Header: AppNavbar]` | **App Navbar (Header)** | แถบนำทางด้านบนสุด มีโลโก้และปุ่มลัด |
| 🏷️ `[Card 1: StatusCard]` | **Status Card (Security & API)** | การ์ดแสดงสถานะ API Key และความปลอดภัย |
| 🏷️ `[Card 2: MetricCard]` | **Metric Card (Quota Tracker)** | การ์ดแสดงสถิติโควตาการใช้งานรายวัน |
| 🏷️ `[Card 3: EngineCard]` | **Engine Card (Hardware Spec)** | การ์ดแสดงสเปก CPU/GPU และสถานะ yt-dlp |
| 🏷️ `[Card 4: CatalogCard]` | **Catalog Card (Library Counter)** | การ์ดนับจำนวนคู่มือทั้งหมดในคลัง |
| 🏷️ `[Section: GeneratorBox]` | **Input Form Controller Box** | กล่องหลักสำหรับรับ URL และเลือกโหมดสร้าง |
| 🏷️ `[Component: ProgressStepper]` | **Progress Stepper Widget** | ไทม์ไลน์ 1-2-3 แสดงความคืบหน้าแบบเคลื่อนไหว |
| 🏷️ `[Alert: ErrorDiagnostics]` | **Diagnostic Alert Box** | กล่องสีแดงสำหรับก็อปปี้ Error รายงาน AI |
| 🏷️ `[Console: ActivityTerminal]` | **Activity Console Log Stream** | หน้าต่าง Terminal จำลองแสดงสถานะสด |
| 🏷️ `[Section: CatalogGrid]` | **Filterable Catalog Grid** | ตะแกรงแสดงคู่มือแยกตามหมวดหมู่พร้อมรูปปก |
| 🏷️ `[Section: ReadingView]` | **Document Reading Viewer** | มุมมองเปิดอ่านเนื้อหาคู่มือพร้อมแถบ Toolbar |
| 🏷️ `[Modal: SettingsDialog]` | **Modal Settings Dialog** | หน้าต่างป๊อปอัปตั้งค่าและทดสอบ Telegram |

---

## 4. โครงสร้างระบบและการตั้งค่าเซิร์ฟเวอร์ (System Specs & Configurations)

* **Server Port:** `3100` (`http://localhost:3100`)
* **Host Hardware:** `Intel(R) Core(TM) i5-9400 CPU @ 2.90GHz (6 Cores) / Intel UHD Graphics`
* **Quality Gate:** `npm run check` (`oxlint src/ && tsc --noEmit`)
* **Telegram Remote Notifications:**
  * Service: `src/services/telegram-notifier.ts`
  * Chat ID: `-4651343086`
  * Events: `START`, `SUCCESS`, `ERROR`, `TEST_REPORT`
* **Output Storage:** `D:\Project\clip-to-manual\manuals/`

---

## 5. กฎเหล็กการพัฒนาสำหรับ AI ในอนาคต (Guiding Principles)
1. **Evidence First (ตรวจเช็คตามหลักฐาน):** ใช้ Chrome DevTools MCP หรือ Node Console ดู Log จริงก่อนลงมือแก้เสมอ
2. **Zero-Touch Execution:** เมื่อได้รับมอบหมายงาน ให้ตรวจสอบและแก้ไขจนผ่านการทดสอบจริง แล้วแจ้งผลผ่าน Telegram ทันที
3. **Keep Separation Clean:** ไม่เขียน Client JavaScript ปะปนใน Template String ของ Backend เป็นอันขาด
