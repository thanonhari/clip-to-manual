import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { parseYouTubeUrl } from '../extractors/youtube-url.js';
import { extractYouTubeTranscript, parseVttOrSrt } from '../extractors/transcript-extractor.js';
import { extractWithYtDlp, isYtDlpAvailable } from '../extractors/yt-dlp-extractor.js';
import { generateManual } from '../generators/ai-manual-generator.js';
import { sendTelegramNotification } from '../services/telegram-notifier.js';
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
    // Enable CORS & Strict Anti-Cache Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

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

    // Static client script
    if (req.method === 'GET' && pathname === '/app.js') {
      try {
        const jsPath = path.join(process.cwd(), 'src', 'server', 'public', 'app.js');
        const content = await fs.readFile(jsPath, 'utf-8');
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
        res.end(content);
      } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Script not found');
      }
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

          // Send Telegram notification
          sendTelegramNotification({
            event: 'SUCCESS',
            title: 'สร้างคู่มือการใช้งานเสร็จสมบูรณ์',
            details: {
              'ชื่อโปรแกรม': result.manual.programName,
              'หัวข้อ': result.manual.title,
              'กลุ่มเป้าหมาย': result.manual.targetAudience,
              'วิดีโอ': body.youtubeUrl || 'N/A'
            },
            message: `สร้างคู่มือสำเร็จและจัดเก็บลงคลังเรียบร้อยแล้ว (${result.manual.stepByStepGuide?.length ?? 0} ตอน/ขั้นตอน)`
          }).catch(() => {});
        } else if (!result.success) {
          sendTelegramNotification({
            event: 'ERROR',
            title: 'สร้างคู่มือไม่สำเร็จ',
            details: {
              'ข้อผิดพลาด': result.error || 'Unknown Error',
              'วิดีโอ': body.youtubeUrl || 'N/A'
            }
          }).catch(() => {});
        }

        res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        sendTelegramNotification({
          event: 'ERROR',
          title: 'เซิร์ฟเวอร์เกิดข้อผิดพลาดในการประมวลผล',
          message: String(err)
        }).catch(() => {});

        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: false, 
          error: `เกิดข้อผิดพลาดในการสร้างคู่มือ: ${String(err)}`,
          stack: err instanceof Error ? err.stack : undefined
        }));
      }
      return;
    }

    // API: Test Telegram Notification
    if (req.method === 'POST' && pathname === '/api/telegram/test') {
      const ok = await sendTelegramNotification({
        event: 'TEST_REPORT',
        title: 'ทดสอบส่งข้อความจากหน้าเว็บ',
        details: {
          'สถานะ': 'เชื่อมต่อ Telegram สำเร็จ',
          'อุปกรณ์': detectSystemHardware()
        },
        message: 'ระบบ Telegram Remote Notification พร้อมทำงานแล้วครับ'
      });
      res.writeHead(ok ? 200 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: ok }));
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
          <span class="text-xs px-2.5 py-0.5 ml-2 bg-indigo-950/90 text-indigo-300 border border-indigo-700/60 rounded-full font-semibold">v1.1.0 • Stepper & Telegram Sync</span>
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

      <div class="space-y-4">
        <div>
          <label class="block text-xs font-semibold text-slate-300 mb-1">Google Gemini API Key (ฟรีจาก AI Studio)</label>
          <input type="password" id="gemini-key-input" placeholder="AIzaSy..." 
            class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono" />
          <p class="text-[11px] text-slate-500 mt-1.5 leading-relaxed">
            🛡️ <strong>ความปลอดภัย:</strong> บันทึกลงเครื่องท่านเท่านั้น หากไม่ใส่คีย์ ระบบจะใช้โหมด Local Deterministic Engine ในการสกัดฟังก์ชันให้ฟรีโดยอัตโนมัติ
          </p>
        </div>

        <div class="pt-2 border-t border-slate-800 space-y-2">
          <label class="block text-xs font-semibold text-slate-300">📱 Telegram Remote Notification & Alerts</label>
          <p class="text-[11px] text-slate-400">ระบบจะส่งการแจ้งเตือนเมื่อสร้างคู่มือเสร็จ หรือเกิดข้อผิดพลาดไปยัง Telegram อัตโนมัติ</p>
          <button onclick="testTelegramNotification()" id="tg-test-btn" type="button" class="w-full py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-indigo-300 rounded-xl transition flex items-center justify-center gap-1.5 shadow">
            <span>✈️</span> <span>ส่งข้อความทดสอบไปยัง Telegram</span>
          </button>
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
  <script src="/app.js"></script>
</body>
</html>`;
}
