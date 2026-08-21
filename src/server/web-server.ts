import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseYouTubeUrl } from '../extractors/youtube-url.js';
import { extractYouTubeTranscript, parseVttOrSrt } from '../extractors/transcript-extractor.js';
import { extractWithYtDlp, isYtDlpAvailable } from '../extractors/yt-dlp-extractor.js';
import { generateManual } from '../generators/ai-manual-generator.js';
import type { ManualGenerationRequest, SoftwareManual } from '../types/manual.js';

interface RequestStat {
  todayCount: number;
  lastResetDate: string;
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

    // Static Web UI
    if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderHtmlApp());
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

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          service: 'clip-to-manual',
          version: '1.0.0',
          system: {
            nodeVersion: process.version,
            platform: process.platform,
            arch: process.arch
          },
          engine: {
            ytDlpAvailable: ytdlp,
            gpu: 'NVIDIA GeForce GTX 1050 Ti (CUDA 12.9)',
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
          res.end(JSON.stringify({ success: false, error: 'Invalid YouTube URL or Video ID.' }));
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
        res.end(JSON.stringify({ success: false, error: String(err) }));
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
          res.end(JSON.stringify({ success: false, error: 'Subtitle content is empty.' }));
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
        res.end(JSON.stringify({ success: false, error: String(err) }));
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

function renderHtmlApp(): string {
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
          <span>คลังคู่มือ & ปก (<span id="nav-manuals-count">0</span>)</span>
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
          <span id="dash-key-badge" class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-slate-400">กำลังตรวจ...</span>
        </div>
        <div id="dash-key-masked" class="text-sm font-mono font-bold text-indigo-300">Checking...</div>
        <div class="text-[11px] text-slate-500">ซ่อนอัตโนมัติ ปลอดภัยเวลาแชร์จอ</div>
      </div>

      <!-- Card 2: Quota & Usage -->
      <div class="bg-slate-900/70 border border-slate-800/80 rounded-2xl p-4 shadow-lg backdrop-blur space-y-2">
        <div class="flex items-center justify-between text-xs text-slate-400">
          <span class="font-medium">📊 Quota วันนี้ (Free Tier)</span>
          <span class="text-emerald-400 font-bold">15 RPM</span>
        </div>
        <div class="text-lg font-bold text-white flex items-baseline gap-1.5">
          <span id="dash-quota-used">0</span>
          <span class="text-xs text-slate-500 font-normal">/ 1,500 คลิปต่อวัน</span>
        </div>
        <div class="w-full bg-slate-800 rounded-full h-1.5">
          <div id="dash-quota-bar" class="bg-indigo-500 h-1.5 rounded-full" style="width: 1%"></div>
        </div>
      </div>

      <!-- Card 3: Engine & Acceleration -->
      <div class="bg-slate-900/70 border border-slate-800/80 rounded-2xl p-4 shadow-lg backdrop-blur space-y-2">
        <div class="flex items-center justify-between text-xs text-slate-400">
          <span class="font-medium">⚡ Extractor Engine</span>
          <span id="dash-ytdlp-badge" class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-800">yt-dlp Active</span>
        </div>
        <div class="text-sm font-bold text-slate-200">GTX 1050 Ti (CUDA 12.9)</div>
        <div class="text-[11px] text-slate-500">ดึง Chapters & Auto-subs ได้ทั้ง Playlist</div>
      </div>

      <!-- Card 4: Library Count -->
      <div class="bg-slate-900/70 border border-slate-800/80 rounded-2xl p-4 shadow-lg backdrop-blur space-y-2">
        <div class="flex items-center justify-between text-xs text-slate-400">
          <span class="font-medium">📁 คลังคู่มือแยกหมวดหมู่</span>
          <span class="text-xs text-indigo-400 cursor-pointer hover:underline" onclick="openManualsLibrary()">ดูคลังปก &rarr;</span>
        </div>
        <div class="text-lg font-bold text-white flex items-baseline gap-1.5">
          <span id="dash-manuals-count">0</span>
          <span class="text-xs text-slate-500 font-normal">คู่มือพร้อมรูปปก</span>
        </div>
        <div class="text-[11px] text-slate-500">จัดกลุ่มตามคอร์ส/เรื่องอัตโนมัติ</div>
      </div>

    </div>

    <!-- Generator Box -->
    <div class="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-6 sm:p-8 shadow-2xl backdrop-blur-xl space-y-6">
      
      <!-- Input Tabs -->
      <div class="flex border-b border-slate-800 space-x-4">
        <button id="tab-yt-btn" onclick="switchInputTab('yt')" class="pb-3 text-sm font-semibold border-b-2 border-indigo-500 text-indigo-400 flex items-center gap-2">
          <span>🎥</span> YouTube URL / Playlist
        </button>
        <button id="tab-sub-btn" onclick="switchInputTab('sub')" class="pb-3 text-sm font-semibold border-b-2 border-transparent text-slate-400 hover:text-slate-200 flex items-center gap-2">
          <span>📝</span> Subtitle / VTT / SRT
        </button>
      </div>

      <!-- Tab 1: YouTube Input -->
      <div id="tab-yt-content" class="space-y-4">
        <div>
          <label class="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">YouTube Video / Playlist URL</label>
          <div class="flex flex-col sm:flex-row gap-3">
            <input id="yt-url-input" type="text" placeholder="https://www.youtube.com/watch?v=... หรือ Playlist URL" 
              class="flex-1 bg-slate-950/80 border border-slate-700/80 rounded-xl px-4 py-3 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition" />
            <button onclick="fetchYouTubeTranscript()" id="fetch-btn" class="px-6 py-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-semibold text-sm rounded-xl transition flex items-center justify-center gap-2 shadow-lg">
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
          <textarea id="subtitle-textarea" rows="6" placeholder="00:00:00.000 --> 00:00:05.000&#10;Hello, today we are looking at this program..."
            class="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl p-4 text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"></textarea>
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
          <span class="text-xs font-medium text-slate-400">ภาษาของคู่มือ:</span>
          <select id="lang-select" class="bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:ring-2 focus:ring-indigo-500">
            <option value="th">🇹🇭 ภาษาไทย (Thai)</option>
            <option value="en">🇬🇧 English</option>
          </select>
        </div>

        <button onclick="generateManualAction()" id="generate-btn" class="w-full sm:w-auto px-8 py-3.5 bg-gradient-to-r from-indigo-600 via-violet-600 to-pink-600 hover:from-indigo-500 hover:to-pink-500 text-white font-bold text-sm rounded-xl transition shadow-xl shadow-indigo-500/20 flex items-center justify-center gap-2">
          <span>✨</span>
          <span>สร้างคู่มือการใช้งาน (Generate Manual)</span>
        </button>
      </div>

      <!-- Alert Box -->
      <div id="status-alert" class="hidden p-4 rounded-xl text-sm border"></div>
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
          <span>⚙️</span> การตั้งค่า & ความปลอดภัย API
        </h3>
        <button onclick="toggleSettingsModal()" class="text-slate-400 hover:text-slate-200 text-lg">&times;</button>
      </div>

      <div class="space-y-3">
        <div>
          <label class="block text-xs font-semibold text-slate-300 mb-1">Google Gemini API Key (ฟรีจาก AI Studio)</label>
          <input type="password" id="gemini-key-input" placeholder="AIzaSy..." 
            class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono" />
          <p class="text-[11px] text-slate-500 mt-1.5 leading-relaxed">
            🛡️ <strong>ความปลอดภัย:</strong> คีย์จะถูกส่งตรงไปยัง Google API เท่านั้น หากตั้งค่าในไฟล์ <code>.env</code> ระบบจะดึงอัตโนมัติโดยไม่ต้องกรอกในช่องนี้
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
    <p>ClipToManual &copy; 2026 - Governed by Oxlint & TypeScript Strict Anti-Slop Quality Gate</p>
    <p class="text-[11px] text-slate-600">Free Tier Quota: 15 Requests/Min &bull; 1,500 Requests/Day &bull; NVIDIA GTX 1050 Ti Accelerated</p>
  </footer>

  <script>
    let currentRawTranscript = '';
    let currentVideoUrl = '';
    let currentMarkdownOutput = '';
    let allLoadedManuals = [];
    let selectedCategory = 'all';

    window.addEventListener('DOMContentLoaded', () => {
      fetchDashboardStats();
      loadManualsLibrary();
      const savedKey = localStorage.getItem('gemini_api_key');
      if (savedKey) {
        document.getElementById('gemini-key-input').value = savedKey;
      }
    });

    async function fetchDashboardStats() {
      try {
        const res = await fetch('/api/stats');
        const data = await res.json();

        if (data.status === 'ok') {
          // Key status
          const keyBadge = document.getElementById('dash-key-badge');
          const keyMasked = document.getElementById('dash-key-masked');
          if (data.apiKeyStatus.configured) {
            keyBadge.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800';
            keyBadge.textContent = 'Configured (' + data.apiKeyStatus.source + ')';
            keyMasked.textContent = data.apiKeyStatus.masked || 'Active in .env';
          } else {
            const browserKey = localStorage.getItem('gemini_api_key');
            if (browserKey) {
              keyBadge.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-950 text-indigo-300 border border-indigo-800';
              keyBadge.textContent = 'Browser Saved';
              keyMasked.textContent = browserKey.slice(0, 6) + '••••••••' + browserKey.slice(-4);
            } else {
              keyBadge.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-800';
              keyBadge.textContent = 'Local Fallback';
              keyMasked.textContent = 'ใส่ใน .env เพื่อเปิดโหมด AI';
            }
          }

          // Quota
          document.getElementById('dash-quota-used').textContent = data.quota.requestsToday;
          const pct = Math.min(100, Math.max(1, (data.quota.requestsToday / data.quota.dailyLimit) * 100));
          document.getElementById('dash-quota-bar').style.width = pct + '%';

          // Manuals
          document.getElementById('dash-manuals-count').textContent = data.manualsCount;
          document.getElementById('nav-manuals-count').textContent = data.manualsCount;
        }
      } catch (err) {
        console.warn('Failed to load stats:', err);
      }
    }

    async function loadManualsLibrary() {
      const container = document.getElementById('manuals-grid-container');
      container.innerHTML = '<div class="col-span-full text-center py-8 text-xs text-slate-500">กำลังโหลดรายการคู่มือและรูปปก...</div>';

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
      const query = (document.getElementById('manual-search-input').value || '').toLowerCase().trim();
      const container = document.getElementById('manuals-grid-container');

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
            '<img src="' + escapeHtml(m.thumbnailUrl) + '" alt="' + escapeHtml(m.title) + '" class="w-full h-full object-cover group-hover:scale-105 transition duration-300">' +
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
      document.getElementById('manuals-library-section').scrollIntoView({ behavior: 'smooth' });
    }

    function closeManualView() {
      document.getElementById('output-container').classList.add('hidden');
      document.getElementById('manuals-library-section').scrollIntoView({ behavior: 'smooth' });
    }

    async function viewSavedManual(encodedFileName) {
      try {
        const res = await fetch('/api/manuals/' + encodedFileName);
        const mdText = await res.text();
        currentMarkdownOutput = mdText;
        
        const firstLine = mdText.split('\n')[0]?.replace(new RegExp('^#\\s*📖?\\s*'), '') || 'คู่มือการใช้งาน';
        document.getElementById('reading-manual-title').textContent = firstLine;

        // Render Markdown with clickable YouTube timestamps and beautiful cards
        const renderedHtml = renderMarkdownToHtml(mdText);
        document.getElementById('manual-view').innerHTML = renderedHtml;

        document.getElementById('output-container').classList.remove('hidden');
        document.getElementById('output-container').scrollIntoView({ behavior: 'smooth' });
      } catch (err) {
        showAlert('ไม่สามารถเปิดไฟล์คู่มือได้: ' + err.message, 'error');
      }
    }

    function renderMarkdownToHtml(md) {
      let html = md;

      // Escape basic HTML
      html = escapeHtml(html);

      // Links: [text](url)
      html = html.replace(new RegExp('\\x5B([^\\]]+)\\x5D\\((https?://[^\\s)]+)\\)', 'g'), '<a href="$2" target="_blank" class="text-indigo-400 hover:text-indigo-300 underline font-medium">$1</a>');

      // Headers
      html = html.replace(/^### (.*$)/gim, '<h3 class="text-base font-bold text-indigo-300 mt-6 mb-2 flex items-center gap-2">$1</h3>');
      html = html.replace(/^## (.*$)/gim, '<h2 class="text-xl font-extrabold text-white mt-8 mb-3 pb-2 border-b border-slate-800 flex items-center gap-2">$1</h2>');
      html = html.replace(/^# (.*$)/gim, '<h1 class="text-2xl sm:text-3xl font-extrabold text-white mb-4 tracking-tight">$1</h1>');

      // Bold & Italic
      html = html.replace(new RegExp('\\x2A\\x2A([^*]+)\\x2A\\x2A', 'g'), '<strong class="font-bold text-white">$1</strong>');
      html = html.replace(new RegExp('\\x2A([^*]+)\\x2A', 'g'), '<em class="text-slate-300">$1</em>');

      // Inline code
      html = html.replace(new RegExp('\\x60([^\\x60]+)\\x60', 'g'), '<code class="bg-slate-950 px-1.5 py-0.5 rounded text-indigo-300 font-mono text-[11px] border border-slate-800">$1</code>');

      // Blockquotes & Alerts
      html = html.replace(new RegExp('^> \\x5B!TIP\\x5D\\s*(.*$)', 'gim'), '<div class="p-3.5 my-3 rounded-xl border bg-emerald-950/40 border-emerald-800/60 text-emerald-200 text-xs flex items-start gap-2"><span>💡</span><span>$1</span></div>');
      html = html.replace(new RegExp('^> \\x5B!WARNING\\x5D\\s*(.*$)', 'gim'), '<div class="p-3.5 my-3 rounded-xl border bg-amber-950/40 border-amber-800/60 text-amber-200 text-xs flex items-start gap-2"><span>⚠️</span><span>$1</span></div>');
      html = html.replace(new RegExp('^> (.*$)', 'gim'), '<blockquote class="border-l-4 border-indigo-500/80 pl-3.5 py-1 text-slate-300 text-xs my-2 italic">$1</blockquote>');

      // HR
      html = html.replace(new RegExp('^---$', 'gim'), '<hr class="border-slate-800 my-6">');

      return '<div class="text-xs sm:text-sm text-slate-300 leading-relaxed space-y-2">' + html.replace(new RegExp('\\n', 'g'), '<br>') + '</div>';
    }

    function toggleSettingsModal() {
      const modal = document.getElementById('settings-modal');
      modal.classList.toggle('hidden');
    }

    function saveSettings() {
      const key = document.getElementById('gemini-key-input').value.trim();
      if (key) {
        localStorage.setItem('gemini_api_key', key);
      } else {
        localStorage.removeItem('gemini_api_key');
      }
      toggleSettingsModal();
      fetchDashboardStats();
      showAlert('บันทึกการตั้งค่าเรียบร้อยแล้ว', 'success');
    }

    function switchInputTab(tab) {
      const ytBtn = document.getElementById('tab-yt-btn');
      const subBtn = document.getElementById('tab-sub-btn');
      const ytContent = document.getElementById('tab-yt-content');
      const subContent = document.getElementById('tab-sub-content');

      if (tab === 'yt') {
        ytBtn.className = 'pb-3 text-sm font-semibold border-b-2 border-indigo-500 text-indigo-400 flex items-center gap-2';
        subBtn.className = 'pb-3 text-sm font-semibold border-b-2 border-transparent text-slate-400 hover:text-slate-200 flex items-center gap-2';
        ytContent.classList.remove('hidden');
        subContent.classList.add('hidden');
      } else {
        subBtn.className = 'pb-3 text-sm font-semibold border-b-2 border-indigo-500 text-indigo-400 flex items-center gap-2';
        ytBtn.className = 'pb-3 text-sm font-semibold border-b-2 border-transparent text-slate-400 hover:text-slate-200 flex items-center gap-2';
        subContent.classList.remove('hidden');
        ytContent.classList.add('hidden');
      }
    }

    async function handleFileUpload(event) {
      const file = event.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (e) => {
        const text = e.target.result;
        document.getElementById('subtitle-textarea').value = text;
        await parseUploadedSubtitle(text);
      };
      reader.readAsText(file);
    }

    async function parseUploadedSubtitle(content) {
      try {
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
        } else {
          showAlert(data.error || 'เกิดข้อผิดพลาดในการประมวลผลซับไตเติล', 'error');
        }
      } catch (err) {
        showAlert('ข้อผิดพลาดเครือข่าย: ' + err.message, 'error');
      }
    }

    async function fetchYouTubeTranscript() {
      const url = document.getElementById('yt-url-input').value.trim();
      if (!url) {
        showAlert('กรุณากรอก YouTube URL', 'error');
        return;
      }

      currentVideoUrl = url;
      setLoading(true, 'กำลังดึงซับไตเติลและข้อมูลจาก YouTube ผ่าน yt-dlp...');

      try {
        const res = await fetch('/api/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url })
        });
        const data = await res.json();

        if (data.success) {
          currentRawTranscript = data.fullText;
          showTranscriptPreview(data.segments, (data.metadata?.title || 'คลิปวิดีโอ') + ' (' + data.segments.length + ' รายการ)');
          showAlert('ดึงซับไตเติลสำเร็จ! พร้อมสร้างคู่มือแล้วครับ', 'success');
        } else {
          showAlert(data.error || 'ไม่พบซับไตเติลอัตโนมัติของคลิปนี้ คุณสามารถเลือกแท็บ Subtitle เพื่อวางข้อความหรืออัปโหลดไฟล์ .vtt/.srt ได้ครับ', 'error');
        }
      } catch (err) {
        showAlert('ข้อผิดพลาดเครือข่าย: ' + err.message, 'error');
      } finally {
        setLoading(false);
      }
    }

    function showTranscriptPreview(segments, label) {
      const box = document.getElementById('transcript-preview-box');
      const labelEl = document.getElementById('transcript-status-label');
      const contentEl = document.getElementById('transcript-raw-content');

      labelEl.textContent = label;
      contentEl.innerHTML = segments.slice(0, 150).map(s => '<div class="flex gap-2"><span class="text-indigo-400 shrink-0">[' + s.formattedTime + ']</span><span>' + escapeHtml(s.text) + '</span></div>').join('');
      box.classList.remove('hidden');
    }

    function toggleTranscriptView() {
      const el = document.getElementById('transcript-raw-content');
      el.classList.toggle('hidden');
    }

    async function generateManualAction() {
      let transcript = currentRawTranscript;
      const subText = document.getElementById('subtitle-textarea').value.trim();

      if (!transcript && subText) {
        transcript = subText;
      }

      if (!transcript) {
        showAlert('กรุณาดึงซับไตเติลจาก YouTube URL หรือวางข้อความ Subtitle ก่อนกดสร้างคู่มือครับ', 'error');
        return;
      }

      const lang = document.getElementById('lang-select').value;
      const apiKey = localStorage.getItem('gemini_api_key') || '';

      setLoading(true, 'AI กำลังวิเคราะห์วิดีโอ สกัดฟังก์ชัน และเรียบเรียงคู่มือทีละ Step...');

      try {
        const res = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            youtubeUrl: currentVideoUrl,
            rawTranscript: transcript,
            language: lang,
            apiKey: apiKey
          })
        });

        const data = await res.json();
        if (data.success && data.manual) {
          currentMarkdownOutput = data.markdown || '';
          renderManualUi(data.manual);
          document.getElementById('output-container').classList.remove('hidden');
          document.getElementById('output-container').scrollIntoView({ behavior: 'smooth' });
          fetchDashboardStats();
          loadManualsLibrary();
          showAlert('สร้างคู่มือการใช้งานสำเร็จและบันทึกลงคลังเรียบร้อย!', 'success');
        } else {
          showAlert(data.error || 'เกิดข้อผิดพลาดในการสร้างคู่มือ', 'error');
        }
      } catch (err) {
        showAlert('ข้อผิดพลาดเครือข่าย: ' + err.message, 'error');
      } finally {
        setLoading(false);
      }
    }

    function renderManualUi(m) {
      const view = document.getElementById('manual-view');
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
      el.className = 'p-4 rounded-xl text-xs font-medium border ' + (type === 'success' ? 'bg-emerald-950/60 border-emerald-800 text-emerald-200' : 'bg-rose-950/60 border-rose-800 text-rose-200');
      el.textContent = msg;
      el.classList.remove('hidden');
    }

    function setLoading(isLoading, text = '') {
      const btn = document.getElementById('generate-btn');
      if (isLoading) {
        btn.disabled = true;
        btn.innerHTML = '<span class="animate-spin">🌀</span><span>' + text + '</span>';
      } else {
        btn.disabled = false;
        btn.innerHTML = '<span>✨</span><span>สร้างคู่มือการใช้งาน (Generate Manual)</span>';
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
