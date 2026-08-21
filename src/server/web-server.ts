import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { parseYouTubeUrl } from '../extractors/youtube-url.js';
import { extractYouTubeTranscript, parseVttOrSrt } from '../extractors/transcript-extractor.js';
import { extractWithYtDlp, isYtDlpAvailable } from '../extractors/yt-dlp-extractor.js';
import { generateManual } from '../generators/ai-manual-generator.js';
import type { ManualGenerationRequest, SoftwareManual } from '../types/manual.js';

interface RequestStat {
  todayCount: number;
  lastResetDate: string;
}

interface SsrState {
  hardware: string;
  isKeyValid: boolean;
  maskedKey: string;
  manualsCount: number;
  requestsToday: number;
}

const statsTracker: RequestStat = {
  todayCount: 0,
  lastResetDate: new Date().toISOString().slice(0, 10)
};

function recordRequest(): void {
  const today = new Date().toISOString().slice(0, 10);
  if (statsTracker.lastResetDate !== today) {
    statsTracker.todayCount = 0;
    statsTracker.lastResetDate = today;
  }
  statsTracker.todayCount++;
}

function detectSystemHardware(): string {
  const cpus = os.cpus();
  const cpuModel = cpus[0]?.model ? cpus[0].model.trim() : 'Intel Core Processor';
  const cores = cpus.length;
  return `${cpuModel} (${cores} Cores) / Intel UHD Graphics`;
}

export function createServer(): http.Server {
  const manualsDir = path.join(process.cwd(), 'manuals');

  return http.createServer(async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = parsedUrl.pathname;

    // Static Web UI with Server-Side Pre-rendered State (Zero Latency)
    if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      const hardwareDesc = detectSystemHardware();
      const envKey = process.env['GEMINI_API_KEY'] ?? '';
      const isKeyValid = envKey.trim().length > 0 && !envKey.includes('ใส่คีย์');
      const maskedKey = isKeyValid ? envKey.substring(0, 6) + '••••••••' + envKey.substring(Math.max(0, envKey.length - 4)) : '';

      let manualsCount = 0;
      try {
        const files = await fs.readdir(manualsDir);
        manualsCount = files.filter((f) => f.endsWith('.md')).length;
      } catch {
        // ignore
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderHtmlApp({
        hardware: hardwareDesc,
        isKeyValid,
        maskedKey,
        manualsCount,
        requestsToday: statsTracker.todayCount
      }));
      return;
    }

    // Health & Dashboard Stats API
    if (req.method === 'GET' && pathname === '/api/stats') {
      const ytdlp = await isYtDlpAvailable();
      const envKey = process.env['GEMINI_API_KEY'] ?? '';
      const isKeyValid = envKey.trim().length > 0 && !envKey.includes('ใส่คีย์');

      let maskedKey = '';
      if (isKeyValid) {
        maskedKey = envKey.substring(0, 6) + '••••••••' + envKey.substring(Math.max(0, envKey.length - 4));
      }

      let manualsCount = 0;
      try {
        const files = await fs.readdir(manualsDir);
        manualsCount = files.filter((f) => f.endsWith('.md')).length;
      } catch {
        // ignore
      }

      const hardwareDesc = detectSystemHardware();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          service: 'clip-to-manual',
          version: '1.0.0',
          system: {
            nodeVersion: process.version,
            platform: process.platform,
            arch: process.arch,
            cpu: hardwareDesc
          },
          engine: {
            ytDlpAvailable: ytdlp,
            hardware: hardwareDesc,
            activeModel: 'Gemini 2.5 Flash / Pro'
          },
          apiKeyStatus: {
            configured: isKeyValid,
            masked: maskedKey,
            source: isKeyValid ? '.env' : 'none'
          },
          quota: {
            requestsToday: statsTracker.todayCount,
            dailyLimit: 1500,
            rpmLimit: 15,
            tier: 'Google AI Studio Free Tier'
          },
          manualsCount
        })
      );
      return;
    }

    // API: List Saved Manuals in manuals/ with rich metadata & thumbnails
    if (req.method === 'GET' && pathname === '/api/manuals') {
      try {
        await fs.mkdir(manualsDir, { recursive: true });
        const files = await fs.readdir(manualsDir);
        const mdFiles = files.filter((f) => f.endsWith('.md'));

        const manualsList = await Promise.all(
          mdFiles.map(async (fileName) => {
            const filePath = path.join(manualsDir, fileName);
            const fileStat = await fs.stat(filePath);
            const content = await fs.readFile(filePath, 'utf-8');

            const firstLine = content.split('\n')[0]?.replace(/^#\s*📖?\s*/, '').trim() ?? fileName;

            // Extract Video ID / Thumbnail URL
            let videoId = '';
            const ytMatch = content.match(/youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/);
            if (ytMatch?.[1]) {
              videoId = ytMatch[1];
            } else {
              const fileIdMatch = fileName.match(/_([a-zA-Z0-9_-]{11})_/);
              if (fileIdMatch?.[1]) {
                videoId = fileIdMatch[1];
              }
            }

            const thumbnailUrl = videoId
              ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
              : 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=400&q=80';

            // Determine if Master Manual or Single Episode
            const isMaster = fileName.toLowerCase().includes('master');
            const epMatch = fileName.match(/EP(\d+)/i) ?? firstLine.match(/EP\.?(\d+)/i);
            const episode = isMaster ? 'Master Guide' : (epMatch?.[1] ? `EP.${epMatch[1]}` : 'Guide');

            // Determine Collection / Topic
            let topic = 'ทั่วไป';
            if (fileName.includes('KruBank') || fileName.startsWith('EP') || content.includes('KruBank') || content.includes('Farm')) {
              topic = 'KruBank Farm Studio';
            } else if (fileName.includes('Linter') || content.includes('Linter')) {
              topic = 'TypeScript & Oxlint';
            } else if (fileName.includes('Pinterest') || content.includes('Pinterest')) {
              topic = 'Pinterest Media Studio';
            }

            let title = firstLine;
            if (isMaster) {
              title = 'KruBank Farm Studio - คู่มือการใช้งานฉบับสมบูรณ์ (Master Manual 8 ตอน)';
            } else if (epMatch?.[1]) {
              const epNames: Record<string, string> = {
                '1': 'EP.1 แนะนำโปรแกรม ภาพรวม',
                '2': 'EP.2 สอนดาวน์โหลด และติดตั้งโปรแกรม',
                '3': 'EP.3 สอนเปิดใช้งานโปรแกรม',
                '4': 'EP.4 สอนเชื่อมช่อง TikTok',
                '5': 'EP.5 สอนใช้งานโหลด & ตัดคลิป',
                '6': 'EP.6 สอนใช้งานโพสต์อัตโนมัติ',
                '7': 'EP.7 สอนใช้งานโพสต์คลิปลง Facebook',
                '8': 'EP.8 สอนโพสต์คลิปลงเพจ Facebook ตั้งเวลาล่วงหน้า'
              };
              title = `KruBank Farm Studio | ${epNames[epMatch[1]] ?? `EP.${epMatch[1]} คู่มือการใช้งาน`}`;
            }

            return {
              fileName,
              title,
              topic,
              episode,
              isMaster,
              thumbnailUrl,
              videoId,
              sizeBytes: fileStat.size,
              createdAt: fileStat.birthtime.toISOString().replace('T', ' ').substring(0, 19)
            };
          })
        );

        manualsList.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, manuals: manualsList }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: String(err) }));
      }
      return;
    }

    // API: Read Single Manual
    if (req.method === 'GET' && pathname.startsWith('/api/manuals/')) {
      try {
        const rawFileName = decodeURIComponent(pathname.replace('/api/manuals/', ''));
        const safeFileName = path.basename(rawFileName);
        const filePath = path.join(manualsDir, safeFileName);
        const content = await fs.readFile(filePath, 'utf-8');

        res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
        res.end(content);
      } catch (err) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: `Manual not found: ${String(err)}` }));
      }
      return;
    }

    // API: Extract transcript from YouTube URL
    if (req.method === 'POST' && pathname === '/api/extract') {
      try {
        const body = await readJsonBody<{ url?: string }>(req);
        const url = body.url?.trim() ?? '';
        const parsed = parseYouTubeUrl(url);

        if (!parsed.isValid || !parsed.videoId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            success: false, 
            error: 'รูปแบบลิงก์ YouTube ไม่ถูกต้อง กรุณาใช้ URL เช่น https://www.youtube.com/watch?v=... หรือ https://youtu.be/...',
            debug: { inputUrl: url, parsed }
          }));
          return;
        }

        // Try yt-dlp first
        const hasYtDlp = await isYtDlpAvailable();
        if (hasYtDlp) {
          const ytDlpResult = await extractWithYtDlp(url);
          if (ytDlpResult.success && ytDlpResult.segments.length > 0) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(ytDlpResult));
            return;
          }
        }

        // Fallback to Native HTTP Extractor
        const result = await extractYouTubeTranscript(parsed.videoId);
        res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: false, 
          error: `เกิดข้อผิดพลาดในการดึงข้อมูล: ${String(err)}`,
          stack: err instanceof Error ? err.stack : undefined
        }));
      }
      return;
    }

    // API: Parse uploaded subtitle / VTT / SRT
    if (req.method === 'POST' && pathname === '/api/parse-subtitle') {
      try {
        const body = await readJsonBody<{ content?: string }>(req);
        const content = body.content?.trim() ?? '';

        if (!content) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'ข้อความ Subtitle ว่างเปล่า' }));
          return;
        }

        const segments = parseVttOrSrt(content);
        const fullText = segments.map((s) => `[${s.formattedTime}] ${s.text}`).join('\n');

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: true,
            segments,
            fullText,
            count: segments.length
          })
        );
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: String(err) }));
      }
      return;
    }

    // API: Generate Manual from Transcript
    if (req.method === 'POST' && pathname === '/api/generate') {
      try {
        const body = await readJsonBody<ManualGenerationRequest>(req);
        recordRequest();
        const result = await generateManual(body);

        // Auto-save to manuals/ directory if successful
        if (result.success && result.markdown && result.manual) {
          try {
            await autoSaveManual(manualsDir, result.manual, result.markdown);
          } catch (saveErr) {
            console.warn('Failed to auto-save manual to disk:', saveErr);
          }
        }

        res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: false, 
          error: `เกิดข้อผิดพลาดในการสร้างคู่มือ: ${String(err)}`,
          stack: err instanceof Error ? err.stack : undefined
        }));
      }
      return;
    }

    // 404 Not Found
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Endpoint not found' }));
  });
}

async function autoSaveManual(dir: string, manual: SoftwareManual, markdown: string): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  const cleanName = manual.programName.replace(/[^a-zA-Z0-9_\-\u0E00-\u0E7F]/g, '_').toLowerCase();
  const dateStamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const fileName = `${dateStamp}_${cleanName || 'manual'}.md`;
  const targetPath = path.join(dir, fileName);
  await fs.writeFile(targetPath, markdown, 'utf-8');
  return fileName;
}

function readJsonBody<T>(req: http.IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(raw.length > 0 ? (JSON.parse(raw) as T) : ({} as T));
      } catch (err) {
        reject(new Error(`Invalid JSON payload: ${String(err)}`));
      }
    });
    req.on('error', reject);
  });
}

function renderHtmlApp(ssr?: SsrState): string {
  const hardware = ssr?.hardware || 'Intel Core Processor / Intel UHD Graphics';
  const requestsToday = ssr?.requestsToday || 0;
  const manualsCount = ssr?.manualsCount || 0;
  const keyLabel = ssr?.isKeyValid ? 'AI Key (.env)' : 'Free Local Engine';
  const keyBadgeClass = ssr?.isKeyValid 
    ? 'bg-emerald-950 text-emerald-300 border-emerald-800' 
    : 'bg-amber-950 text-amber-300 border-amber-800';
  const keyMasked = ssr?.isKeyValid && ssr.maskedKey 
    ? ssr.maskedKey 
    : 'โหมดในตัว (กด ⚙️ ใส่คีย์ AI ได้)';

  return `<!DOCTYPE html>
<html lang="th" class="h-full bg-slate-950 text-slate-100">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ClipToManual - AI Software Manual Studio & Course Library</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Sarabun:wght@400;500;600;700&family=Fira+Code:wght@400;500&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Plus Jakarta Sans', 'Sarabun', sans-serif; }
    code, pre { font-family: 'Fira Code', monospace; }
    @keyframes pulse-fast {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.6; transform: scale(1.03); }
    }
    .pulse-step { animation: pulse-fast 1.5s infinite ease-in-out; }
  </style>
</head>
<body class="min-h-full flex flex-col bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100 selection:bg-indigo-500 selection:text-white">

  <!-- Header -->
  <header class="border-b border-slate-800/80 bg-slate-900/60 backdrop-blur-xl sticky top-0 z-50">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
      <div class="flex items-center space-x-3">
        <div class="h-10 w-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-violet-600 to-pink-500 flex items-center justify-center shadow-lg shadow-indigo-500/25">
          <span class="text-xl">📖</span>
        </div>
        <div>
          <span class="font-extrabold text-lg tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 via-purple-300 to-pink-400">ClipToManual</span>
          <span class="text-xs px-2 py-0.5 ml-2 bg-indigo-950/80 text-indigo-300 border border-indigo-700/50 rounded-full font-medium">Studio & Library</span>
        </div>
      </div>
      <div class="flex items-center space-x-3">
        <button onclick="openManualsLibrary()" class="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-indigo-950/80 hover:bg-indigo-900 text-indigo-300 border border-indigo-700/60 transition flex items-center gap-1.5 shadow-md">
          <span>📚</span>
          <span>คลังคู่มือ & ปก (<span id="nav-manuals-count">${manualsCount}</span>)</span>
        </button>
        <button onclick="toggleSettingsModal()" class="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition flex items-center gap-1.5">
          <span>⚙️</span>
          <span>ตั้งค่า / API Key</span>
        </button>
      </div>
    </div>
  </header>

  <!-- Main Container -->
  <main class="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
    
    <!-- Dashboard Status Grid -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      
      <!-- Card 1: API & Security Status -->
      <div class="bg-slate-900/70 border border-slate-800/80 rounded-2xl p-4 shadow-lg backdrop-blur space-y-2">
        <div class="flex items-center justify-between text-xs text-slate-400">
          <span class="font-medium">🛡️ Gemini API Key</span>
          <span id="dash-key-badge" class="px-2 py-0.5 rounded-full text-[10px] font-bold border ${keyBadgeClass}">${keyLabel}</span>
        </div>
        <div id="dash-key-masked" class="text-xs font-mono font-bold text-indigo-300 truncate">${keyMasked}</div>
        <div class="text-[11px] text-slate-500">ซ่อนอัตโนมัติ ปลอดภัยเวลาแชร์จอ</div>
      </div>

      <!-- Card 2: Quota & Usage -->
      <div class="bg-slate-900/70 border border-slate-800/80 rounded-2xl p-4 shadow-lg backdrop-blur space-y-2">
        <div class="flex items-center justify-between text-xs text-slate-400">
          <span class="font-medium">📊 Quota วันนี้ (Free Tier)</span>
          <span class="text-emerald-400 font-bold">15 RPM</span>
        </div>
        <div class="text-lg font-bold text-white flex items-baseline gap-1.5">
          <span id="dash-quota-used">${requestsToday}</span>
          <span class="text-xs text-slate-500 font-normal">/ 1,500 คลิปต่อวัน</span>
        </div>
        <div class="w-full bg-slate-800 rounded-full h-1.5">
          <div id="dash-quota-bar" class="bg-indigo-500 h-1.5 rounded-full" style="width: 1%"></div>
        </div>
      </div>

      <!-- Card 3: Engine & Acceleration -->
      <div class="bg-slate-900/70 border border-slate-800/80 rounded-2xl p-4 shadow-lg backdrop-blur space-y-2">
        <div class="flex items-center justify-between text-xs text-slate-400">
          <span class="font-medium">⚡ Extractor & Hardware</span>
          <span id="dash-ytdlp-badge" class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-800">yt-dlp พร้อม</span>
        </div>
        <div id="dash-engine-desc" class="text-xs font-bold text-slate-200 truncate" title="${hardware}">${hardware}</div>
        <div class="text-[11px] text-slate-500">ดึง Chapters & ซับไตเติลแม่นยำ</div>
      </div>

      <!-- Card 4: Library Count -->
      <div class="bg-slate-900/70 border border-slate-800/80 rounded-2xl p-4 shadow-lg backdrop-blur space-y-2">
        <div class="flex items-center justify-between text-xs text-slate-400">
          <span class="font-medium">📁 คลังคู่มือแยกหมวดหมู่</span>
          <span class="text-xs text-indigo-400 cursor-pointer hover:underline" onclick="openManualsLibrary()">ดูคลังปก &rarr;</span>
        </div>
        <div class="text-lg font-bold text-white flex items-baseline gap-1.5">
          <span id="dash-manuals-count">${manualsCount}</span>
          <span class="text-xs text-slate-500 font-normal">คู่มือพร้อมรูปปก</span>
        </div>
        <div class="text-[11px] text-slate-500">จัดกลุ่มตามคอร์ส/เรื่องอัตโนมัติ</div>
      </div>

    </div>

    <!-- Generator Box -->
    <div class="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-6 sm:p-8 shadow-2xl backdrop-blur-xl space-y-6">
      
      <!-- Input Tabs & 1-Click Demo -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-2">
        <div class="flex space-x-4">
          <button id="tab-yt-btn" onclick="switchInputTab('yt')" class="pb-2 text-sm font-semibold border-b-2 border-indigo-500 text-indigo-400 flex items-center gap-2">
            <span>🎥</span> YouTube URL / Playlist
          </button>
          <button id="tab-sub-btn" onclick="switchInputTab('sub')" class="pb-2 text-sm font-semibold border-b-2 border-transparent text-slate-400 hover:text-slate-200 flex items-center gap-2">
            <span>📝</span> Subtitle / VTT / SRT
          </button>
        </div>
        <div>
          <button onclick="fillDemoUrl()" class="px-3 py-1 bg-indigo-950/80 hover:bg-indigo-900 text-indigo-300 border border-indigo-700/60 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 shadow">
            <span>⚡</span> <span>ลองคลิปตัวอย่าง (1-Click Demo)</span>
          </button>
        </div>
      </div>

      <!-- Tab 1: YouTube Input -->
      <div id="tab-yt-content" class="space-y-4">
        <div>
          <label class="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">วางลิงก์ YouTube Video หรือ Playlist (กด Enter หรือกดปุ่มสร้างได้ทันที)</label>
          <div class="flex flex-col sm:flex-row gap-3">
            <input id="yt-url-input" type="text" placeholder="https://www.youtube.com/watch?v=... หรือ Playlist URL" 
              class="flex-1 bg-slate-950/80 border border-slate-700/80 rounded-xl px-4 py-3 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition" />
            <button onclick="fetchYouTubeTranscript()" id="fetch-btn" class="px-5 py-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-semibold text-xs rounded-xl transition flex items-center justify-center gap-2 shadow-lg">
              <span>📥</span>
              <span>ดึงซับไตเติล</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Tab 2: Direct Subtitle Input -->
      <div id="tab-sub-content" class="space-y-4 hidden">
        <div>
          <div class="flex items-center justify-between mb-1.5">
            <label class="text-xs font-semibold text-slate-300 uppercase tracking-wider">วางเนื้อหา Subtitle (.vtt, .srt, หรือข้อความพร้อมเวลา)</label>
            <label class="cursor-pointer text-xs font-medium text-indigo-400 hover:text-indigo-300 flex items-center gap-1">
              <span>📂 อัปโหลดไฟล์ .vtt/.srt</span>
              <input type="file" id="file-upload" accept=".vtt,.srt,.txt" onchange="handleFileUpload(event)" class="hidden">
            </label>
          </div>
          <textarea id="subtitle-textarea" rows="6" placeholder="00:00:00.000 --> 00:00:05.000&#10;สวัสดีครับ วันนี้เราจะมาเรียนรู้วิธีติดตั้งโปรแกรม..."
            class="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl p-4 text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"></textarea>
        </div>
      </div>

      <!-- Live Step-by-Step Progress Animation Box -->
      <div id="progress-stepper-box" class="hidden rounded-xl bg-slate-950/90 border border-indigo-500/40 p-5 space-y-4 shadow-xl">
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold text-indigo-300 flex items-center gap-2">
            <span class="animate-spin text-sm">🌀</span>
            <span id="stepper-main-status">กำลังดำเนินการ...</span>
          </span>
          <span id="stepper-elapsed-time" class="text-xs font-mono text-slate-400">0s</span>
        </div>
        
        <!-- Steps Timeline Indicator -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
          <!-- Step 1 -->
          <div id="step-node-1" class="bg-slate-900 border border-slate-800 rounded-xl p-3 flex items-center gap-3 transition">
            <div id="step-icon-1" class="h-7 w-7 rounded-lg bg-slate-800 flex items-center justify-center text-xs font-bold text-slate-400">1</div>
            <div>
              <div class="text-xs font-bold text-slate-300">ดึง Transcript</div>
              <div id="step-sub-1" class="text-[11px] text-slate-500">yt-dlp Extraction</div>
            </div>
          </div>
          <!-- Step 2 -->
          <div id="step-node-2" class="bg-slate-900 border border-slate-800 rounded-xl p-3 flex items-center gap-3 transition">
            <div id="step-icon-2" class="h-7 w-7 rounded-lg bg-slate-800 flex items-center justify-center text-xs font-bold text-slate-400">2</div>
            <div>
              <div class="text-xs font-bold text-slate-300">วิเคราะห์ฟังก์ชัน</div>
              <div id="step-sub-2" class="text-[11px] text-slate-500">AI Synthesis</div>
            </div>
          </div>
          <!-- Step 3 -->
          <div id="step-node-3" class="bg-slate-900 border border-slate-800 rounded-xl p-3 flex items-center gap-3 transition">
            <div id="step-icon-3" class="h-7 w-7 rounded-lg bg-slate-800 flex items-center justify-center text-xs font-bold text-slate-400">3</div>
            <div>
              <div class="text-xs font-bold text-slate-300">สร้างคู่มือ & คลัง</div>
              <div id="step-sub-3" class="text-[11px] text-slate-500">Render & Save .md</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Transcript Preview Area (Collapsible) -->
      <div id="transcript-preview-box" class="hidden rounded-xl bg-slate-950/60 border border-slate-800/80 p-4 space-y-2">
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold text-emerald-400 flex items-center gap-1.5">
            <span>✅</span>
            <span id="transcript-status-label">ดึง Transcript สำเร็จ</span>
          </span>
          <button onclick="toggleTranscriptView()" class="text-xs text-slate-400 hover:text-slate-200 underline">ซ่อน/แสดง ข้อความดิบ</button>
        </div>
        <div id="transcript-raw-content" class="max-h-40 overflow-y-auto text-xs text-slate-400 font-mono space-y-1 pr-2"></div>
      </div>

      <!-- Controls & Language Selector -->
      <div class="pt-2 flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-slate-800/80">
        <div class="flex items-center space-x-3 w-full sm:w-auto">
          <span class="text-xs font-medium text-slate-400">ภาษาคู่มือ:</span>
          <select id="lang-select" class="bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:ring-2 focus:ring-indigo-500">
            <option value="th">🇹🇭 ภาษาไทย (Thai)</option>
            <option value="en">🇬🇧 English</option>
          </select>
        </div>

        <button onclick="generateManualAction()" id="generate-btn" class="w-full sm:w-auto px-8 py-3.5 bg-gradient-to-r from-indigo-600 via-violet-600 to-pink-600 hover:from-indigo-500 hover:to-pink-500 text-white font-bold text-sm rounded-xl transition shadow-xl shadow-indigo-500/20 flex items-center justify-center gap-2">
          <span>✨</span>
          <span id="generate-btn-text">สร้างคู่มือการใช้งาน (1-Click Generate)</span>
        </button>
      </div>

      <!-- Enhanced Error Diagnostic Box with 1-Click Copy -->
      <div id="error-diagnostic-box" class="hidden rounded-xl bg-rose-950/70 border border-rose-800/90 p-5 space-y-3 shadow-2xl">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2 text-rose-300 font-bold text-xs">
            <span class="text-base">⚠️</span>
            <span id="error-title-text">เกิดข้อผิดพลาดในการประมวลผล</span>
          </div>
          <button onclick="copyErrorDiagnostics()" class="px-3 py-1.5 bg-rose-900/90 hover:bg-rose-800 border border-rose-700 text-white text-xs font-semibold rounded-lg transition flex items-center gap-1.5 shadow">
            <span>📋</span>
            <span id="copy-err-btn-text">คัดลอก Error ทั้งหมดไปให้ AI ดู</span>
          </button>
        </div>
        <p id="error-summary-msg" class="text-xs text-rose-200 leading-relaxed"></p>
        <div class="bg-slate-950/90 border border-rose-900/60 rounded-lg p-3 max-h-36 overflow-y-auto">
          <pre id="error-raw-stack" class="text-[11px] font-mono text-rose-300 whitespace-pre-wrap leading-tight"></pre>
        </div>
      </div>

      <!-- Live Terminal Activity / Debug Log (Collapsible) -->
      <div class="pt-2 border-t border-slate-800/60">
        <div class="flex items-center justify-between mb-2">
          <button onclick="toggleTerminalLogs()" class="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1.5">
            <span>🖥️</span>
            <span>Live Activity / Debug Log (<span id="log-count">0</span> รายการ)</span>
            <span id="log-toggle-arrow" class="text-[10px] transition">▼</span>
          </button>
          <button onclick="copyTerminalLogs()" class="text-[11px] text-indigo-400 hover:text-indigo-300 underline">
            📋 คัดลอก Logs ทั้งหมด
          </button>
        </div>
        <div id="terminal-log-container" class="hidden bg-slate-950 border border-slate-800 rounded-xl p-3.5 max-h-48 overflow-y-auto font-mono text-[11px] text-slate-400 space-y-1">
          <div class="text-slate-600">[System] พร้อมรับคำสั่ง...</div>
        </div>
      </div>

      <!-- Alert Box -->
      <div id="status-alert" class="hidden p-4 rounded-xl text-xs border"></div>
    </div>

    <!-- Manuals Library Section (Categorized Grid with Thumbnails) -->
    <div id="manuals-library-section" class="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-6 shadow-2xl">
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <h2 class="text-lg font-bold text-white flex items-center gap-2">
            <span>📚</span> คลังคู่มือแยกตามหมวดหมู่ & รูปปกตัวอย่าง
          </h2>
          <p class="text-xs text-slate-400 mt-1">คู่มือที่จัดเก็บไว้ในเครื่อง สามารถค้นหา เปิดอ่าน หรือดาวน์โหลดได้ทันที</p>
        </div>
        <div class="flex items-center gap-2 w-full sm:w-auto">
          <input id="manual-search-input" oninput="filterManualsGrid()" type="text" placeholder="🔍 ค้นหาคู่มือ / ชื่อคอร์ส..." 
            class="bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:ring-2 focus:ring-indigo-500 w-full sm:w-56" />
        </div>
      </div>

      <!-- Category Filter Tabs -->
      <div id="manual-category-tabs" class="flex flex-wrap gap-2">
        <!-- Rendered dynamically -->
      </div>

      <!-- Cards Grid -->
      <div id="manuals-grid-container" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        <!-- Rendered dynamically -->
      </div>
    </div>

    <!-- Output Display Area -->
    <div id="output-container" class="hidden space-y-6">
      
      <!-- Output Actions Header -->
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-slate-900/90 border border-slate-800 p-5 rounded-2xl shadow-xl sticky top-20 z-40 backdrop-blur-xl">
        <div>
          <div class="flex items-center gap-2 mb-1">
            <span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-indigo-950 text-indigo-300 border border-indigo-800">Reading View</span>
            <span id="output-meta-text" class="text-xs text-slate-400">บันทึกสำเนาลงใน /manuals เรียบร้อย</span>
          </div>
          <h2 class="text-lg font-bold text-white flex items-center gap-2">
            <span>📋</span> <span id="reading-manual-title" class="text-indigo-300"></span>
          </h2>
        </div>
        <div class="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <button onclick="copyMarkdown()" class="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold rounded-xl text-slate-200 transition flex items-center gap-1.5 shadow">
            <span>📋</span> Copy
          </button>
          <button onclick="downloadMarkdown()" class="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold rounded-xl text-white transition flex items-center gap-1.5 shadow-md">
            <span>💾</span> ดาวน์โหลด .md
          </button>
          <button onclick="window.print()" class="px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold rounded-xl text-slate-200 transition">
            <span>🖨️</span> พิมพ์
          </button>
          <button onclick="closeManualView()" class="px-4 py-2 bg-rose-950/80 hover:bg-rose-900 border border-rose-800 text-rose-300 text-xs font-bold rounded-xl transition flex items-center gap-1.5 shadow-md">
            <span>❌</span> <span>ปิดหน้ารายละเอียด</span>
          </button>
        </div>
      </div>

      <!-- Output View -->
      <div id="manual-view" class="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 sm:p-10 space-y-8 shadow-2xl">
        <!-- Rendered dynamically -->
      </div>
    </div>

  </main>

  <!-- Settings Modal -->
  <div id="settings-modal" class="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 hidden">
    <div class="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-5 shadow-2xl">
      <div class="flex items-center justify-between">
        <h3 class="text-base font-bold text-white flex items-center gap-2">
          <span>⚙️</span> การตั้งค่า & ความปลอดภัย API Key
        </h3>
        <button onclick="toggleSettingsModal()" class="text-slate-400 hover:text-slate-200 text-lg">&times;</button>
      </div>

      <div class="space-y-3">
        <div>
          <label class="block text-xs font-semibold text-slate-300 mb-1">Google Gemini API Key (ฟรีจาก AI Studio)</label>
          <input type="password" id="gemini-key-input" placeholder="AIzaSy..." 
            class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono" />
          <p class="text-[11px] text-slate-500 mt-1.5 leading-relaxed">
            🛡️ <strong>ความปลอดภัย:</strong> บันทึกลงเครื่องท่านเท่านั้น หากไม่ใส่คีย์ ระบบจะใช้โหมด Local Deterministic Engine ในการสกัดฟังก์ชันให้ฟรีโดยอัตโนมัติ
          </p>
        </div>
      </div>

      <div class="flex justify-end space-x-2 pt-2 border-t border-slate-800">
        <button onclick="toggleSettingsModal()" class="px-4 py-2 text-xs font-semibold rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700">ปิด</button>
        <button onclick="saveSettings()" class="px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-500">บันทึก</button>
      </div>
    </div>
  </div>

  <!-- Footer -->
  <footer class="border-t border-slate-800/80 py-6 text-center text-xs text-slate-500 space-y-1">
    <p>ClipToManual &copy; 2026 - Governed by Oxlint & TypeScript Strict Quality Gate</p>
    <p class="text-[11px] text-slate-600">Free Tier: 15 RPM / 1,500 Requests/Day &bull; High-Performance Automation</p>
  </footer>

  <script>
    let currentRawTranscript = '';
    let currentVideoUrl = '';
    let currentMarkdownOutput = '';
    let allLoadedManuals = [];
    let selectedCategory = 'all';
    let lastErrorPayload = null;
    let activityLogs = [];
    let stepperTimer = null;
    let stepperStartTime = 0;

    function initApp() {
      fetchDashboardStats();
      loadManualsLibrary();
      const savedKey = localStorage.getItem('gemini_api_key');
      if (savedKey) {
        const inputEl = document.getElementById('gemini-key-input');
        if (inputEl) inputEl.value = savedKey;
      }

      const urlInput = document.getElementById('yt-url-input');
      if (urlInput) {
        urlInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            generateManualAction();
          }
        });
      }
      logEvent('info', 'ClipToManual UI Initialized');
    }

    initApp();
    window.addEventListener('DOMContentLoaded', initApp);

    function logEvent(type, message, details) {
      const now = new Date().toTimeString().slice(0, 8);
      const logItem = { time: now, type, message, details };
      activityLogs.push(logItem);

      const countEl = document.getElementById('log-count');
      if (countEl) countEl.textContent = activityLogs.length;

      const container = document.getElementById('terminal-log-container');
      if (container) {
        const color = type === 'error' ? 'text-rose-400' : (type === 'success' ? 'text-emerald-400' : 'text-slate-300');
        const icon = type === 'error' ? '❌' : (type === 'success' ? '✅' : '🔹');
        const entry = document.createElement('div');
        entry.className = 'flex items-start gap-1.5 ' + color;
        entry.innerHTML = '<span class="text-slate-600 shrink-0">[' + now + ']</span><span>' + icon + ' ' + escapeHtml(message) + '</span>';
        container.appendChild(entry);
        container.scrollTop = container.scrollHeight;
      }
    }

    function toggleTerminalLogs() {
      const container = document.getElementById('terminal-log-container');
      const arrow = document.getElementById('log-toggle-arrow');
      if (container) {
        container.classList.toggle('hidden');
        if (arrow) arrow.textContent = container.classList.contains('hidden') ? '▼' : '▲';
      }
    }

    function copyTerminalLogs() {
      if (activityLogs.length === 0) return;
      const text = activityLogs.map(l => '[' + l.time + '] [' + l.type.toUpperCase() + '] ' + l.message + (l.details ? ' -> ' + JSON.stringify(l.details) : '')).join('\n');
      navigator.clipboard.writeText(text);
      showAlert('คัดลอก Logs ทั้งหมดลงคลิปบอร์ดแล้ว', 'success');
    }

    function fillDemoUrl() {
      const demoUrl = 'https://www.youtube.com/watch?v=k85mRPqvMbE';
      const inputEl = document.getElementById('yt-url-input');
      if (inputEl) inputEl.value = demoUrl;
      switchInputTab('yt');
      logEvent('info', 'โหลดลิงก์ตัวอย่าง YouTube สำเร็จ');
      showAlert('ใส่ลิงก์คลิปตัวอย่างเรียบร้อยแล้ว กดปุ่ม "สร้างคู่มือการใช้งาน" ได้ทันทีครับ', 'success');
    }

    function startStepper() {
      const box = document.getElementById('progress-stepper-box');
      if (box) box.classList.remove('hidden');
      stepperStartTime = Date.now();
      
      const timeEl = document.getElementById('stepper-elapsed-time');
      if (stepperTimer) clearInterval(stepperTimer);
      stepperTimer = setInterval(() => {
        const sec = Math.floor((Date.now() - stepperStartTime) / 1000);
        if (timeEl) timeEl.textContent = sec + 's';
      }, 500);
      
      setStepActive(1);
    }

    function stopStepper() {
      if (stepperTimer) {
        clearInterval(stepperTimer);
        stepperTimer = null;
      }
      const box = document.getElementById('progress-stepper-box');
      if (box) box.classList.add('hidden');
    }

    function setStepActive(stepNum, statusText) {
      const mainStatus = document.getElementById('stepper-main-status');
      if (mainStatus && statusText) mainStatus.textContent = statusText;

      for (let i = 1; i <= 3; i++) {
        const node = document.getElementById('step-node-' + i);
        const icon = document.getElementById('step-icon-' + i);
        if (!node || !icon) continue;

        if (i < stepNum) {
          node.className = 'bg-emerald-950/60 border border-emerald-800/80 rounded-xl p-3 flex items-center gap-3 transition';
          icon.className = 'h-7 w-7 rounded-lg bg-emerald-900 text-emerald-300 flex items-center justify-center text-xs font-bold';
          icon.innerHTML = '✓';
        } else if (i === stepNum) {
          node.className = 'bg-indigo-950/80 border border-indigo-500 rounded-xl p-3 flex items-center gap-3 transition shadow-lg shadow-indigo-500/20 pulse-step';
          icon.className = 'h-7 w-7 rounded-lg bg-indigo-600 text-white flex items-center justify-center text-xs font-bold animate-spin';
          icon.innerHTML = '🌀';
        } else {
          node.className = 'bg-slate-900 border border-slate-800 rounded-xl p-3 flex items-center gap-3 transition opacity-50';
          icon.className = 'h-7 w-7 rounded-lg bg-slate-800 text-slate-500 flex items-center justify-center text-xs font-bold';
          icon.innerHTML = i;
        }
      }
    }

    function showErrorDiagnostic(title, message, errorObject) {
      hideAlert();
      lastErrorPayload = {
        timestamp: new Date().toISOString(),
        title,
        message,
        url: currentVideoUrl || (document.getElementById('yt-url-input')?.value || ''),
        rawError: errorObject || message,
        system: {
          userAgent: navigator.userAgent,
          localStorageKeyConfigured: Boolean(localStorage.getItem('gemini_api_key'))
        }
      };

      logEvent('error', title + ': ' + message, lastErrorPayload);

      const errBox = document.getElementById('error-diagnostic-box');
      const titleEl = document.getElementById('error-title-text');
      const msgEl = document.getElementById('error-summary-msg');
      const stackEl = document.getElementById('error-raw-stack');

      if (titleEl) titleEl.textContent = title;
      if (msgEl) msgEl.textContent = message;
      if (stackEl) stackEl.textContent = typeof errorObject === 'object' ? JSON.stringify(errorObject, null, 2) : String(errorObject || message);
      if (errBox) {
        errBox.classList.remove('hidden');
        errBox.scrollIntoView({ behavior: 'smooth' });
      }
    }

    function hideErrorDiagnostic() {
      const errBox = document.getElementById('error-diagnostic-box');
      if (errBox) errBox.classList.add('hidden');
    }

    function copyErrorDiagnostics() {
      if (!lastErrorPayload) return;
      const fence = String.fromCharCode(96, 96, 96);
      const text = fence + 'json\n' + JSON.stringify(lastErrorPayload, null, 2) + '\n' + fence;
      navigator.clipboard.writeText(text);
      const btnText = document.getElementById('copy-err-btn-text');
      if (btnText) {
        btnText.textContent = '✅ คัดลอกสำเร็จแล้ว!';
        setTimeout(() => { btnText.textContent = 'คัดลอก Error ทั้งหมดไปให้ AI ดู'; }, 3000);
      }
    }

    async function fetchDashboardStats() {
      try {
        const res = await fetch('/api/stats');
        const data = await res.json();

        if (data.status === 'ok') {
          // Key status
          const keyBadge = document.getElementById('dash-key-badge');
          const keyMasked = document.getElementById('dash-key-masked');
          const browserKey = localStorage.getItem('gemini_api_key');

          if (data.apiKeyStatus && data.apiKeyStatus.configured) {
            if (keyBadge) {
              keyBadge.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800';
              keyBadge.textContent = 'AI Key (.env)';
            }
            if (keyMasked) keyMasked.textContent = data.apiKeyStatus.masked || 'Active in .env';
          } else if (browserKey && browserKey.length > 5) {
            if (keyBadge) {
              keyBadge.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-950 text-indigo-300 border border-indigo-800';
              keyBadge.textContent = 'AI Key (Browser)';
            }
            if (keyMasked) keyMasked.textContent = browserKey.slice(0, 6) + '••••••••' + browserKey.slice(-4);
          } else {
            if (keyBadge) {
              keyBadge.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-800';
              keyBadge.textContent = 'Free Local Engine';
            }
            if (keyMasked) keyMasked.textContent = 'โหมดในตัว (กด ⚙️ ใส่คีย์ AI ได้)';
          }

          // Hardware
          if (data.engine && data.engine.hardware) {
            const engineDesc = document.getElementById('dash-engine-desc');
            if (engineDesc) {
              engineDesc.textContent = data.engine.hardware;
              engineDesc.title = data.engine.hardware;
            }
          }

          // Quota
          if (data.quota) {
            const quotaUsed = document.getElementById('dash-quota-used');
            if (quotaUsed) quotaUsed.textContent = data.quota.requestsToday;
            const pct = Math.min(100, Math.max(1, (data.quota.requestsToday / data.quota.dailyLimit) * 100));
            const quotaBar = document.getElementById('dash-quota-bar');
            if (quotaBar) quotaBar.style.width = pct + '%';
          }

          // Manuals
          const dashCount = document.getElementById('dash-manuals-count');
          const navCount = document.getElementById('nav-manuals-count');
          if (dashCount) dashCount.textContent = data.manualsCount;
          if (navCount) navCount.textContent = data.manualsCount;
        }
      } catch (err) {
        console.warn('Failed to load stats:', err);
      }
    }

    async function loadManualsLibrary() {
      const container = document.getElementById('manuals-grid-container');
      if (!container) return;

      try {
        const res = await fetch('/api/manuals');
        const data = await res.json();
        if (data.success && data.manuals) {
          allLoadedManuals = data.manuals;
          renderCategoryTabs();
          filterManualsGrid();
        }
      } catch (err) {
        container.innerHTML = '<div class="col-span-full text-center py-8 text-xs text-rose-400">เกิดข้อผิดพลาด: ' + err.message + '</div>';
      }
    }

    function renderCategoryTabs() {
      const tabsContainer = document.getElementById('manual-category-tabs');
      if (!tabsContainer) return;
      const categories = Array.from(new Set(allLoadedManuals.map(m => m.topic || 'ทั่วไป')));
      
      let html = '<button onclick="selectCategory(' + "'all'" + ')" class="px-3 py-1 rounded-lg text-xs font-semibold transition ' + (selectedCategory === 'all' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200') + '">ทั้งหมด (' + allLoadedManuals.length + ')</button>';
      
      for (const cat of categories) {
        const count = allLoadedManuals.filter(m => m.topic === cat).length;
        const active = selectedCategory === cat;
        html += '<button onclick="selectCategory(' + "'" + escapeHtml(cat) + "'" + ')" class="px-3 py-1 rounded-lg text-xs font-semibold transition ' + (active ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200') + '">' + escapeHtml(cat) + ' (' + count + ')</button>';
      }

      tabsContainer.innerHTML = html;
    }

    function selectCategory(cat) {
      selectedCategory = cat;
      renderCategoryTabs();
      filterManualsGrid();
    }

    function filterManualsGrid() {
      const inputEl = document.getElementById('manual-search-input');
      const query = (inputEl ? inputEl.value : '').toLowerCase().trim();
      const container = document.getElementById('manuals-grid-container');
      if (!container) return;

      const filtered = allLoadedManuals.filter(m => {
        const matchesCategory = selectedCategory === 'all' || m.topic === selectedCategory;
        const matchesQuery = !query || m.title.toLowerCase().includes(query) || (m.topic || '').toLowerCase().includes(query) || m.fileName.toLowerCase().includes(query);
        return matchesCategory && matchesQuery;
      });

      if (filtered.length === 0) {
        container.innerHTML = '<div class="col-span-full text-center py-12 text-xs text-slate-500 bg-slate-950/40 rounded-2xl border border-slate-800/80">ไม่พบคู่มือในหมวดหมู่นี้ คุณสามารถวางลิงก์ YouTube ด้านบนเพื่อสร้างคู่มือใหม่ได้ครับ</div>';
        return;
      }

      container.innerHTML = filtered.map(m => {
        const badgeColor = m.isMaster ? 'bg-amber-950 text-amber-300 border-amber-800' : 'bg-indigo-950 text-indigo-300 border-indigo-800';
        return '<div class="bg-slate-950/90 border border-slate-800 hover:border-slate-700 rounded-2xl overflow-hidden shadow-xl hover:shadow-2xl transition flex flex-col group">' +
          '<div class="relative aspect-video w-full overflow-hidden bg-slate-900">' +
            '<img src="' + escapeHtml(m.thumbnailUrl) + '" alt="' + escapeHtml(m.title) + '" class="w-full h-full object-cover group-hover:scale-105 transition duration-300" onerror="this.src=\'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=400&q=80\'">' +
            '<div class="absolute top-2 left-2 flex gap-1.5">' +
              '<span class="px-2 py-0.5 rounded-md text-[10px] font-bold border backdrop-blur-md ' + badgeColor + '">' + escapeHtml(m.episode) + '</span>' +
              '<span class="px-2 py-0.5 rounded-md text-[10px] font-medium bg-slate-900/80 text-slate-300 border border-slate-700 backdrop-blur-md">' + escapeHtml(m.topic) + '</span>' +
            '</div>' +
          '</div>' +
          '<div class="p-4 flex-1 flex flex-col justify-between space-y-3">' +
            '<div>' +
              '<h3 class="text-xs font-bold text-slate-100 line-clamp-2 leading-snug group-hover:text-indigo-400 transition" title="' + escapeHtml(m.title) + '">' + escapeHtml(m.title) + '</h3>' +
              '<div class="text-[11px] text-slate-500 mt-1.5 font-mono">' + m.createdAt + '</div>' +
            '</div>' +
            '<div class="pt-2 border-t border-slate-800/80 flex items-center justify-between gap-2">' +
              '<button onclick="viewSavedManual(' + "'" + encodeURIComponent(m.fileName) + "'" + ')" class="flex-1 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-semibold text-xs transition flex items-center justify-center gap-1 shadow-md">' +
                '<span>📖 เปิดอ่าน</span>' +
              '</button>' +
              (m.videoId ? '<a href="https://www.youtube.com/watch?v=' + m.videoId + '" target="_blank" class="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs transition" title="ดูวิดีโอบน YouTube">🎥</a>' : '') +
            '</div>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    function openManualsLibrary() {
      const section = document.getElementById('manuals-library-section');
      if (section) section.scrollIntoView({ behavior: 'smooth' });
    }

    function closeManualView() {
      const outContainer = document.getElementById('output-container');
      if (outContainer) outContainer.classList.add('hidden');
      const section = document.getElementById('manuals-library-section');
      if (section) section.scrollIntoView({ behavior: 'smooth' });
    }

    async function viewSavedManual(encodedFileName) {
      try {
        const res = await fetch('/api/manuals/' + encodedFileName);
        const mdText = await res.text();
        currentMarkdownOutput = mdText;
        
        const firstLine = mdText.split('\n')[0]?.replace(/^#\s*📖?\s*/, '') || 'คู่มือการใช้งาน';
        const titleEl = document.getElementById('reading-manual-title');
        if (titleEl) titleEl.textContent = firstLine;

        const renderedHtml = renderMarkdownToHtml(mdText);
        const manualView = document.getElementById('manual-view');
        if (manualView) manualView.innerHTML = renderedHtml;

        const outContainer = document.getElementById('output-container');
        if (outContainer) {
          outContainer.classList.remove('hidden');
          outContainer.scrollIntoView({ behavior: 'smooth' });
        }
      } catch (err) {
        showErrorDiagnostic('เปิดไฟล์คู่มือไม่สำเร็จ', err.message, err);
      }
    }

    function renderMarkdownToHtml(md) {
      let html = md;
      html = escapeHtml(html);

      // Links: [text](url)
      html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" class="text-indigo-400 hover:text-indigo-300 underline font-medium">$1</a>');

      // Headers
      html = html.replace(/^### (.*$)/gim, '<h3 class="text-base font-bold text-indigo-300 mt-6 mb-2 flex items-center gap-2">$1</h3>');
      html = html.replace(/^## (.*$)/gim, '<h2 class="text-xl font-extrabold text-white mt-8 mb-3 pb-2 border-b border-slate-800 flex items-center gap-2">$1</h2>');
      html = html.replace(/^# (.*$)/gim, '<h1 class="text-2xl sm:text-3xl font-extrabold text-white mb-4 tracking-tight">$1</h1>');

      // Bold & Italic
      html = html.replace(/\*\*([^*]+)\*\*/g, '<strong class="font-bold text-white">$1</strong>');
      html = html.replace(/\*([^*]+)\*/g, '<em class="text-slate-300">$1</em>');

      // Inline code
      html = html.replace(new RegExp('\\x60([^\\x60]+)\\x60', 'g'), '<code class="bg-slate-950 px-1.5 py-0.5 rounded text-indigo-300 font-mono text-[11px] border border-slate-800">$1</code>');

      // Blockquotes & Alerts
      html = html.replace(/^> \[!TIP\]\s*(.*$)/gim, '<div class="p-3.5 my-3 rounded-xl border bg-emerald-950/40 border-emerald-800/60 text-emerald-200 text-xs flex items-start gap-2"><span>💡</span><span>$1</span></div>');
      html = html.replace(/^> \[!WARNING\]\s*(.*$)/gim, '<div class="p-3.5 my-3 rounded-xl border bg-amber-950/40 border-amber-800/60 text-amber-200 text-xs flex items-start gap-2"><span>⚠️</span><span>$1</span></div>');
      html = html.replace(/^> (.*$)/gim, '<blockquote class="border-l-4 border-indigo-500/80 pl-3.5 py-1 text-slate-300 text-xs my-2 italic">$1</blockquote>');

      // HR
      html = html.replace(/^---$/gim, '<hr class="border-slate-800 my-6">');

      return '<div class="text-xs sm:text-sm text-slate-300 leading-relaxed space-y-2">' + html.replace(/\n/g, '<br>') + '</div>';
    }

    function toggleSettingsModal() {
      const modal = document.getElementById('settings-modal');
      if (modal) modal.classList.toggle('hidden');
    }

    function saveSettings() {
      const inputEl = document.getElementById('gemini-key-input');
      const key = inputEl ? inputEl.value.trim() : '';
      if (key) {
        localStorage.setItem('gemini_api_key', key);
      } else {
        localStorage.removeItem('gemini_api_key');
      }
      toggleSettingsModal();
      fetchDashboardStats();
      showAlert('บันทึกการตั้งค่า API Key เรียบร้อยแล้ว', 'success');
    }

    function switchInputTab(tab) {
      const ytBtn = document.getElementById('tab-yt-btn');
      const subBtn = document.getElementById('tab-sub-btn');
      const ytContent = document.getElementById('tab-yt-content');
      const subContent = document.getElementById('tab-sub-content');

      if (tab === 'yt') {
        if (ytBtn) ytBtn.className = 'pb-2 text-sm font-semibold border-b-2 border-indigo-500 text-indigo-400 flex items-center gap-2';
        if (subBtn) subBtn.className = 'pb-2 text-sm font-semibold border-b-2 border-transparent text-slate-400 hover:text-slate-200 flex items-center gap-2';
        if (ytContent) ytContent.classList.remove('hidden');
        if (subContent) subContent.classList.add('hidden');
      } else {
        if (subBtn) subBtn.className = 'pb-2 text-sm font-semibold border-b-2 border-indigo-500 text-indigo-400 flex items-center gap-2';
        if (ytBtn) ytBtn.className = 'pb-2 text-sm font-semibold border-b-2 border-transparent text-slate-400 hover:text-slate-200 flex items-center gap-2';
        if (subContent) subContent.classList.remove('hidden');
        if (ytContent) ytContent.classList.add('hidden');
      }
    }

    async function handleFileUpload(event) {
      const file = event.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (e) => {
        const text = e.target.result;
        const subArea = document.getElementById('subtitle-textarea');
        if (subArea) subArea.value = text;
        await parseUploadedSubtitle(text);
      };
      reader.readAsText(file);
    }

    async function parseUploadedSubtitle(content) {
      try {
        logEvent('info', 'กำลังแปลงข้อความ Subtitle ที่อัปโหลด...');
        const res = await fetch('/api/parse-subtitle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content })
        });
        const data = await res.json();
        if (data.success) {
          currentRawTranscript = data.fullText;
          showTranscriptPreview(data.segments, data.count + ' รายการเวลา');
          showAlert('นำเข้าซับไตเติลสำเร็จ ' + data.count + ' ข้อความ', 'success');
          logEvent('success', 'แปลง Subtitle สำเร็จ ' + data.count + ' ข้อความ');
        } else {
          showErrorDiagnostic('การแปลง Subtitle ผิดพลาด', data.error, data);
        }
      } catch (err) {
        showErrorDiagnostic('ข้อผิดพลาดเครือข่าย', err.message, err);
      }
    }

    async function fetchYouTubeTranscript() {
      hideErrorDiagnostic();
      const inputEl = document.getElementById('yt-url-input');
      const url = inputEl ? inputEl.value.trim() : '';
      if (!url) {
        showAlert('กรุณากรอกหรือวาง YouTube URL', 'error');
        return false;
      }

      currentVideoUrl = url;
      logEvent('info', 'กำลังดึง Transcript จาก URL: ' + url);
      setLoading(true, 'กำลังดึงซับไตเติลผ่าน yt-dlp...');
      setStepActive(1, '[1/3] กำลังดึงข้อมูลและ Subtitle จาก YouTube...');

      try {
        const res = await fetch('/api/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url })
        });
        const data = await res.json();

        if (data.success && data.segments && data.segments.length > 0) {
          currentRawTranscript = data.fullText;
          showTranscriptPreview(data.segments, (data.metadata?.title || 'คลิปวิดีโอ') + ' (' + data.segments.length + ' รายการ)');
          showAlert('ดึงซับไตเติลสำเร็จ (' + data.segments.length + ' ข้อความ)', 'success');
          logEvent('success', 'ดึง Transcript สำเร็จ: ' + (data.metadata?.title || '') + ' (' + data.segments.length + ' ตอน)');
          return true;
        } else {
          showErrorDiagnostic(
            'ไม่พบ Transcript หรือซับไตเติลของคลิปนี้',
            data.error || 'คลิปนี้อาจไม่มีซับไตเติลอัตโนมัติ หรือ YouTube บล็อกคำขอ คุณสามารถเลือกแท็บ Subtitle ด้านบนเพื่อวางข้อความเองได้ครับ',
            data
          );
          return false;
        }
      } catch (err) {
        showErrorDiagnostic('ข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์', err.message, err);
        return false;
      } finally {
        setLoading(false);
      }
    }

    function showTranscriptPreview(segments, label) {
      const box = document.getElementById('transcript-preview-box');
      const labelEl = document.getElementById('transcript-status-label');
      const contentEl = document.getElementById('transcript-raw-content');

      if (labelEl) labelEl.textContent = label;
      if (contentEl) {
        contentEl.innerHTML = segments.slice(0, 150).map(s => '<div class="flex gap-2"><span class="text-indigo-400 shrink-0">[' + s.formattedTime + ']</span><span>' + escapeHtml(s.text) + '</span></div>').join('');
      }
      if (box) box.classList.remove('hidden');
    }

    function toggleTranscriptView() {
      const el = document.getElementById('transcript-raw-content');
      if (el) el.classList.toggle('hidden');
    }

    async function generateManualAction() {
      hideErrorDiagnostic();
      hideAlert();

      let transcript = currentRawTranscript;
      const urlInput = document.getElementById('yt-url-input');
      const urlVal = urlInput ? urlInput.value.trim() : '';
      const subArea = document.getElementById('subtitle-textarea');
      const subText = subArea ? subArea.value.trim() : '';

      startStepper();

      // If transcript not yet extracted, but YouTube URL is provided: Auto 1-Click Pull!
      if (!transcript && urlVal) {
        setLoading(true, '[1/3] 📥 กำลังดึงซับไตเติล...');
        setStepActive(1, '[1/3] 📥 กำลังดึงข้อมูลและ Subtitle จาก YouTube...');
        const fetched = await fetchYouTubeTranscript();
        if (fetched) {
          transcript = currentRawTranscript;
        } else {
          stopStepper();
          setLoading(false);
          return;
        }
      } else if (!transcript && subText) {
        transcript = subText;
      }

      if (!transcript) {
        stopStepper();
        showErrorDiagnostic('ยังไม่มีข้อมูลสำหรับสร้างคู่มือ', 'กรุณาวาง YouTube URL หรือข้อความ Subtitle ก่อนกดสร้างคู่มือครับ');
        return;
      }

      const langSelect = document.getElementById('lang-select');
      const lang = langSelect ? langSelect.value : 'th';
      const apiKey = localStorage.getItem('gemini_api_key') || '';

      setLoading(true, '[2/3] ✨ AI กำลังวิเคราะห์และเรียบเรียงคู่มือ...');
      setStepActive(2, '[2/3] ✨ AI กำลังวิเคราะห์ฟังก์ชันและจัดทำ Step-by-Step...');
      logEvent('info', 'เริ่มประมวลผลสร้างคู่มือ (ภาษา: ' + lang + ', โหมด: ' + (apiKey ? 'Gemini AI' : 'Local Deterministic') + ')');

      try {
        const res = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            youtubeUrl: currentVideoUrl || urlVal,
            rawTranscript: transcript,
            language: lang,
            apiKey: apiKey
          })
        });

        const data = await res.json();
        if (data.success && data.manual) {
          setStepActive(3, '[3/3] 💾 บันทึกคู่มือและสร้างคลังเสร็จสมบูรณ์!');
          logEvent('success', 'สร้างคู่มือสำเร็จ: ' + data.manual.title);
          currentMarkdownOutput = data.markdown || '';
          renderManualUi(data.manual);
          
          setTimeout(() => {
            stopStepper();
            const outContainer = document.getElementById('output-container');
            if (outContainer) {
              outContainer.classList.remove('hidden');
              outContainer.scrollIntoView({ behavior: 'smooth' });
            }
          }, 800);

          fetchDashboardStats();
          loadManualsLibrary();
          showAlert('🎉 สร้างคู่มือการใช้งานสำเร็จและบันทึกลงคลังเรียบร้อย!', 'success');
        } else {
          stopStepper();
          showErrorDiagnostic('เกิดข้อผิดพลาดในการสร้างคู่มือ', data.error || 'เซิร์ฟเวอร์ไม่สามารถสังเคราะห์คู่มือได้', data);
        }
      } catch (err) {
        stopStepper();
        showErrorDiagnostic('ข้อผิดพลาดการเชื่อมต่อ API /generate', err.message, err);
      } finally {
        setLoading(false);
      }
    }

    function renderManualUi(m) {
      const view = document.getElementById('manual-view');
      if (!view) return;
      const isThai = m.language === 'th';

      let html = '';

      // Header Banner
      html += '<div class="border-b border-slate-800 pb-6">';
      html += '<div class="flex flex-wrap items-center gap-2 mb-2">';
      html += '<span class="px-3 py-1 bg-indigo-950 text-indigo-300 border border-indigo-800/60 rounded-lg text-xs font-bold uppercase tracking-wider">' + escapeHtml(m.programName) + '</span>';
      html += '<span class="px-3 py-1 bg-slate-800 text-slate-300 rounded-lg text-xs font-medium">🎯 ' + escapeHtml(m.targetAudience) + '</span>';
      html += '</div>';
      html += '<h1 class="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">' + escapeHtml(m.title) + '</h1>';
      html += '<p class="text-slate-400 text-sm mt-3 leading-relaxed">' + escapeHtml(m.overview) + '</p>';
      html += '</div>';

      // Core Capabilities
      if (m.coreCapabilities && m.coreCapabilities.length > 0) {
        html += '<div class="space-y-3">';
        html += '<h3 class="text-base font-bold text-white flex items-center gap-2"><span>🌟</span> ' + (isThai ? 'ความสามารถหลัก' : 'Core Capabilities') + '</h3>';
        html += '<div class="grid grid-cols-1 md:grid-cols-2 gap-2.5">';
        for (const cap of m.coreCapabilities) {
          html += '<div class="flex items-start gap-2 bg-slate-950/60 border border-slate-800 p-3 rounded-xl text-xs text-slate-200">';
          html += '<span class="text-emerald-400 mt-0.5">✅</span><span>' + escapeHtml(cap) + '</span>';
          html += '</div>';
        }
        html += '</div></div>';
      }

      // Features Table
      if (m.features && m.features.length > 0) {
        html += '<div class="space-y-3">';
        html += '<h3 class="text-base font-bold text-white flex items-center gap-2"><span>🧩</span> ' + (isThai ? 'รายการฟังก์ชันและการทำงาน' : 'Feature Breakdown') + '</h3>';
        html += '<div class="overflow-x-auto border border-slate-800 rounded-xl">';
        html += '<table class="w-full text-left text-xs">';
        html += '<thead class="bg-slate-950/80 text-slate-400 border-b border-slate-800 uppercase tracking-wider font-semibold"><tr><th class="p-3.5">ฟังก์ชัน</th><th class="p-3.5">รายละเอียด</th><th class="p-3.5">ประโยชน์</th></tr></thead>';
        html += '<tbody class="divide-y divide-slate-800/60">';
        for (const f of m.features) {
          html += '<tr class="hover:bg-slate-800/30 transition"><td class="p-3.5 font-bold text-indigo-300">' + escapeHtml(f.name) + '</td><td class="p-3.5 text-slate-300">' + escapeHtml(f.description) + '</td><td class="p-3.5 text-slate-400">' + escapeHtml(f.purpose) + '</td></tr>';
        }
        html += '</tbody></table></div></div>';
      }

      // Step-by-Step Guide
      if (m.stepByStepGuide && m.stepByStepGuide.length > 0) {
        html += '<div class="space-y-4">';
        html += '<h3 class="text-base font-bold text-white flex items-center gap-2"><span>🚀</span> ' + (isThai ? 'ขั้นตอนการใช้งานทีละ Step' : 'Step-by-Step User Guide') + '</h3>';
        
        for (const section of m.stepByStepGuide) {
          html += '<div class="bg-slate-950/80 border border-slate-800/90 rounded-xl p-5 space-y-4">';
          html += '<h4 class="text-sm font-bold text-indigo-400 uppercase tracking-wider flex items-center gap-2"><span>📂</span> ' + escapeHtml(section.sectionName) + '</h4>';
          html += '<div class="space-y-3">';

          for (const s of section.steps) {
            let timeBtn = '';
            if (s.timestamp) {
              const href = m.sourceVideoUrl ? makeYtLink(m.sourceVideoUrl, s.timestamp) : '#';
              timeBtn = '<a href="' + href + '" target="_blank" class="px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800/80 text-[11px] font-mono hover:bg-indigo-900 transition ml-2">⏱️ ' + escapeHtml(s.timestamp) + '</a>';
            }

            html += '<div class="bg-slate-900 border border-slate-800 p-4 rounded-xl space-y-2">';
            html += '<div class="flex items-center justify-between">';
            html += '<span class="text-xs font-bold text-white flex items-center">Step ' + s.stepNumber + ': ' + escapeHtml(s.title) + timeBtn + '</span>';
            html += '<span class="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 uppercase font-semibold">' + escapeHtml(s.actionType) + '</span>';
            html += '</div>';
            html += '<p class="text-xs text-slate-300 leading-relaxed">' + escapeHtml(s.description) + '</p>';
            if (s.codeSnippet) {
              html += '<pre class="bg-slate-950 p-2.5 rounded-lg text-xs text-emerald-400 overflow-x-auto border border-slate-800"><code>' + escapeHtml(s.codeSnippet) + '</code></pre>';
            }
            html += '</div>';
          }

          html += '</div></div>';
        }

        html += '</div>';
      }

      // Shortcuts & Configs
      if (m.shortcutsAndConfigs && m.shortcutsAndConfigs.length > 0) {
        html += '<div class="space-y-3">';
        html += '<h3 class="text-base font-bold text-white flex items-center gap-2"><span>⌨️</span> ' + (isThai ? 'คีย์ลัดและการตั้งค่าสำคัญ' : 'Shortcuts & Configurations') + '</h3>';
        html += '<div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">';
        for (const sc of m.shortcutsAndConfigs) {
          html += '<div class="bg-slate-950/60 border border-slate-800 p-3 rounded-xl flex items-center justify-between text-xs">';
          html += '<code class="bg-slate-800 px-2 py-1 rounded text-indigo-300 font-bold">' + escapeHtml(sc.key) + '</code>';
          html += '<span class="text-slate-300">' + escapeHtml(sc.action) + '</span>';
          html += '</div>';
        }
        html += '</div></div>';
      }

      // Tips & Warnings
      if (m.tipsAndWarnings && m.tipsAndWarnings.length > 0) {
        html += '<div class="space-y-3">';
        html += '<h3 class="text-base font-bold text-white flex items-center gap-2"><span>⚠️</span> ' + (isThai ? 'ข้อควรระวังและเทคนิคแนะนำ' : 'Tips & Warnings') + '</h3>';
        for (const tw of m.tipsAndWarnings) {
          const isWarn = tw.type === 'warning' || tw.type === 'gotcha';
          const bg = isWarn ? 'bg-amber-950/40 border-amber-800/60 text-amber-200' : 'bg-emerald-950/40 border-emerald-800/60 text-emerald-200';
          const icon = isWarn ? '⚠️' : '💡';
          html += '<div class="p-3.5 rounded-xl border text-xs flex items-start gap-2.5 ' + bg + '">';
          html += '<span>' + icon + '</span><span>' + escapeHtml(tw.message) + '</span>';
          html += '</div>';
        }
        html += '</div>';
      }

      // FAQ
      if (m.faq && m.faq.length > 0) {
        html += '<div class="space-y-3">';
        html += '<h3 class="text-base font-bold text-white flex items-center gap-2"><span>❓</span> ' + (isThai ? 'คำถามที่พบบ่อย (FAQ)' : 'FAQ') + '</h3>';
        html += '<div class="space-y-2">';
        for (const q of m.faq) {
          html += '<details class="bg-slate-950/60 border border-slate-800 rounded-xl p-3.5 text-xs group">';
          html += '<summary class="font-bold text-slate-200 cursor-pointer list-none flex justify-between items-center"><span>Q: ' + escapeHtml(q.question) + '</span><span class="text-indigo-400 group-open:rotate-180 transition">▼</span></summary>';
          html += '<p class="mt-2 text-slate-400 pt-2 border-t border-slate-800/60 leading-relaxed">A: ' + escapeHtml(q.answer) + '</p>';
          html += '</details>';
        }
        html += '</div></div>';
      }

      view.innerHTML = html;
    }

    function makeYtLink(url, timestamp) {
      const parts = timestamp.split(':').map(Number);
      let sec = 0;
      if (parts.length === 2) sec = parts[0] * 60 + parts[1];
      if (parts.length === 3) sec = parts[0] * 3600 + parts[1] * 60 + parts[2];
      try {
        const u = new URL(url);
        u.searchParams.set('t', sec + 's');
        return u.toString();
      } catch {
        return url + '&t=' + sec + 's';
      }
    }

    function copyMarkdown() {
      if (!currentMarkdownOutput) return;
      navigator.clipboard.writeText(currentMarkdownOutput);
      showAlert('คัดลอก Markdown ลงคลิปบอร์ดแล้ว!', 'success');
    }

    function downloadMarkdown() {
      if (!currentMarkdownOutput) return;
      const blob = new Blob([currentMarkdownOutput], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'software-manual.md';
      a.click();
      URL.revokeObjectURL(url);
    }

    function showAlert(msg, type) {
      const el = document.getElementById('status-alert');
      if (!el) return;
      el.className = 'p-4 rounded-xl text-xs font-medium border ' + (type === 'success' ? 'bg-emerald-950/60 border-emerald-800 text-emerald-200' : 'bg-rose-950/60 border-rose-800 text-rose-200');
      el.textContent = msg;
      el.classList.remove('hidden');
    }

    function hideAlert() {
      const el = document.getElementById('status-alert');
      if (el) el.classList.add('hidden');
    }

    function setLoading(isLoading, text = '') {
      const btn = document.getElementById('generate-btn');
      const btnText = document.getElementById('generate-btn-text');
      if (btn) btn.disabled = isLoading;
      if (btnText) {
        btnText.textContent = isLoading ? (text || 'กำลังประมวลผล...') : 'สร้างคู่มือการใช้งาน (1-Click Generate)';
      }
    }

    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }
  </script>
</body>
</html>`;
}
