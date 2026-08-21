# Handoff: ClipToManual - Course Series Accordion UI, Aligned List View & Thai Formal Skills

**Created:** 2026-08-21 12:00 (UTC+7)  
**Branch:** `main`  
**Repository:** `https://github.com/thanonhari/clip-to-manual.git`  
**Active Port:** `http://localhost:3100`  

---

## Summary

In this session, we transformed the **Catalog Grid** of the ClipToManual application into a **Pixel-Perfect Course Series Accordion UI with Master-Detail Hierarchy**. Instead of displaying multiple individual episode rows that clutter the screen, the system groups multi-episode courses (like the 10-episode *KruBank Farm Studio*) into **one clean master row**. When clicked, it smoothly expands into an indented sub-list of all 10 episodes with fixed-width column alignment, dual action buttons (Details Modal & Quick Read), and individual/bulk safe deletion. We also researched and aligned on integrating Thai official document standards from `Boom-Vitt/claude-thai-skills` for future print and PDF compilation.

---

## Work Completed

### Changes Made

- [x] **Course Details Modal (`#manual-details-modal`):**
  - Displays high-resolution video thumbnail, YouTube link, episode/topic badges, creation timestamp.
  - Generates an Executive Overview summary extracted from the manual markdown.
  - Shows 3 quick metrics: Steps Count, Estimated Read Time (`~X นาที`), and File Size (`KB`).
  - Renders a clickable Table of Contents (TOC) for instant section preview.
  - Added primary action button `📖 เปิดอ่านคู่มือฉบับเต็ม` and `🗑️ ลบคู่มือนี้`.
- [x] **Floating Quick Scroll Navigator (`#floating-scroll-nav`):**
  - Bottom-right frosted glass floating controller with `▲` (Scroll to Top), `📚` (Jump to Catalog), and `▼` (Scroll to Bottom).
- [x] **Pixel-Perfect List View & View Mode Switcher:**
  - Added `setViewMode('list')` and `setViewMode('grid')` switcher in the catalog header.
  - Standardized column widths (`w-28` thumbnail, `w-32` badges, `truncate` title, `w-36` date/stats, and action button bar) so rows remain 100% aligned regardless of title length.
- [x] **Course Series Accordion & Master-Detail Hierarchy:**
  - Grouped manuals by course topic (`courseGroups`).
  - Renders 1 master course row with `🎓 ชุดคอร์ส (X ตอน)` badge, total size, and latest update date.
  - Added `📂 ดูรายชื่อ X ตอน ▼` / `📂 ซ่อนรายการตอน ▲` toggle button (`toggleCourseAccordion(topicName)`).
  - Sub-episodes render in an indented, organized child list with their own `🔍 รายละเอียด`, `📖 อ่าน`, `🗑️ ลบตอนนี้`, and `🎥 YouTube` buttons.
- [x] **Manual & Course Series Deletion Feature:**
  - Added `DELETE /api/manuals/:fileName` endpoint in `src/server/web-server.ts`.
  - Implemented `deleteManual(encodedFileName, title)` with safety confirmation and instant counter refresh.
  - Implemented `deleteCourseSeries(topicName)` to delete all episodes in a course bundle in one click.
- [x] **Living Knowledge Base Updates (`KNOWLEDGE_BASE.md`):**
  - Documented computer science and UI/UX terminology: `Accordion UI`, `Parent-Child Hierarchy`, `Master-Detail View`, `Truncation & Fixed Grid Alignment`, and `Modal Dialog`.
- [x] **Researched Thai Official Document Repositories on GitHub:**
  - Identified **`Boom-Vitt/claude-thai-skills`** (`thai-government-form` & `thai-formal-writing`) as the primary benchmark for official Thai document structure and formatting.

---

### Key Decisions

| Decision | Rationale | Alternatives Considered |
|---|---|---|
| **Course Series Accordion as Default View** | Reduces cognitive overload when viewing 10+ episodes of the same course (e.g. KruBank Farm Studio). | Flat card grid showing all 10 cards individually. |
| **Fixed CSS Truncation for Row Alignment** | Prevents long titles from warping table columns and breaking layout symmetry. | Dynamic multi-line wrapping (caused uneven row heights). |
| **Separation of Client JS into `app.js`** | Eliminates template string escaping bugs, allows zero-warning static analysis with `oxlint` and `node -c`. | Inline scripts inside backend HTML literals. |
| **Integration of `Boom-Vitt/claude-thai-skills`** | Provides battle-tested Thai government document rules (Office of the Prime Minister's regulations) without reinventing rules. | Writing prompt rules from scratch without standardized reference. |

---

## Files Affected

### Created
- `D:\Project\clip-to-manual\HANDOFF_CATALOG_ACCORDION_2026-08-21.md` - Comprehensive session handoff document.

### Modified
- `D:\Project\clip-to-manual\src\server\web-server.ts`:
  - Added `DELETE /api/manuals/:fileName` route with safe path traversal checks.
  - Added View Mode toggle buttons (List vs Grid) in `#manuals-library-section`.
  - Added `#modal-delete-btn` to `#manual-details-modal`.
- `D:\Project\clip-to-manual\src\server\public\app.js`:
  - Added `currentViewMode`, `expandedCourses`, `setViewMode(mode)`, and `toggleCourseAccordion(topicName)`.
  - Implemented grouped Course Series Accordion in `filterManualsGrid()`.
  - Added `openManualDetails(encodedFileName)` and `closeManualDetailsModal()`.
  - Added `deleteManual(encodedFileName, title)` and `deleteCourseSeries(topicName)`.
  - Added `scrollToTop()` and `scrollToBottom()`.
  - Exported all new functions to `window` for HTML event handlers.
- `D:\Project\clip-to-manual\KNOWLEDGE_BASE.md`:
  - Added definitions for `Accordion UI`, `Parent-Child Hierarchy`, `Master-Detail View`, and `Fixed Grid Alignment`.

---

## Technical Context

### Architecture & Endpoints
* **Web Server:** Node.js HTTP Server (`src/server/web-server.ts`) running on port `3100`.
* **API Endpoints:**
  * `GET /api/stats` - Dashboard metrics (CPU, RAM, API Key status, manuals count).
  * `GET /api/manuals` - Scans `manuals/` directory and parses metadata (title, topic, episode, overview, steps, size, date).
  * `GET /api/manuals/:fileName` - Returns raw markdown content.
  * `DELETE /api/manuals/:fileName` - Deletes `.md` file from disk.
  * `POST /api/extract` - Extracts YouTube transcript via `youtube-transcript` / `yt-dlp`.
  * `POST /api/generate` - Invokes Gemini AI (`gemini-flash-latest` / `gemini-3.5-flash`) with Telegram notifications.
* **Client Architecture:** Vanilla JS (`src/server/public/app.js`) with zero external bundle dependencies, fully styled using Tailwind CSS CDN.

---

## Next Steps

1. [ ] **Integrate `Boom-Vitt/claude-thai-skills` into AI Manual Generator:**
   - Update `src/generators/ai-manual-generator.ts` with formal Thai grammar and government document structure rules.
2. [ ] **Add Official Thai Print CSS (`@media print`):**
   - Configure `@media print` with Google Fonts `Sarabun` and standard Thai government margins (Top 2.5cm, Left 3.0cm, Right 2.0cm, Bottom 2.0cm).
3. [ ] **Implement Complete Course E-Book / PDF Exporter:**
   - Add a 1-click button to compile all 10 episodes into a single comprehensive Master Manual `.md` and printable PDF.
4. [ ] **Add YouTube Playlist Batch Extractor:**
   - Allow entering a single YouTube Playlist URL to automatically process all episodes in sequence.
