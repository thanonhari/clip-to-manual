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
          version: '1.2.0',
          system: {
            nodeVersion: process.version,
            platform: process.platform,
            arch: process.arch,
            cpu: hardwareDesc
          },
          engine: {
            ytDlpAvailable: ytdlp,
            hardware: hardwareDesc,
            activeModel: 'Gemini 2.5 / 3.5 Flash'
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

            // Extract Overview summary
            const overviewMatch = content.match(/## 🎯 ภาพรวมและจุดประสงค์การใช้งาน\s*\n+([\s\S]+?)(?=\n##|$)/) ||
                                  content.match(/## Overview\s*\n+([\s\S]+?)(?=\n##|$)/);
            const overview = overviewMatch?.[1]?.trim() || '';

            // Count Steps
            const stepMatches = content.match(/### Step \d+/g);
            const stepsCount = stepMatches ? stepMatches.length : 0;

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
            } else if (fileName.includes('python') || content.includes('Python')) {
              topic = 'Python & Programming';
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
              overview,
              stepsCount,
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

    // API: Delete Single Manual
    if (req.method === 'DELETE' && pathname.startsWith('/api/manuals/')) {
      try {
        const rawFileName = decodeURIComponent(pathname.replace('/api/manuals/', ''));
        const safeFileName = path.basename(rawFileName);
        const filePath = path.join(manualsDir, safeFileName);
        await fs.unlink(filePath);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Deleted successfully' }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: `Failed to delete: ${String(err)}` }));
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
<html lang="th" class="h-full bg-slate-950 text-slate-100 scroll-smooth">
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
    .ui-tag { transition: all 0.2s ease-in-out; }
    .ui-tag:hover { transform: translateY(-1px); }
  </style>
</head>
<body class="min-h-full flex flex-col bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100 selection:bg-indigo-500 selection:text-white relative">

  <!-- Header: Application Navbar / AppHeader -->
  <header class="border-b border-slate-800/80 bg-slate-900/60 backdrop-blur-xl sticky top-0 z-50">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
      <div class="flex items-center space-x-3">
        <div class="h-10 w-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-violet-600 to-pink-500 flex items-center justify-center shadow-lg shadow-indigo-500/25">
          <span class="text-xl">📖</span>
        </div>
        <div>
          <div class="flex items-center gap-2">
            <span class="font-extrabold text-lg tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 via-purple-300 to-pink-400">ClipToManual</span>
            <span class="text-xs px-2.5 py-0.5 bg-indigo-950/90 text-indigo-300 border border-indigo-700/60 rounded-full font-semibold">v1.3.0</span>
            <span class="ui-tag px-2 py-0.5 rounded bg-indigo-950 text-indigo-400 border border-indigo-700 font-mono text-[9px] cursor-pointer hover:bg-indigo-900 shadow" onclick="copyUiTag('[Header: AppNavbar]')">🏷️ #Header</span>
          </div>
        </div>
      </div>
      <div class="flex items-center space-x-2 sm:space-x-3">
        <!-- UI Inspector Toggle Button -->
        <button onclick="toggleUiTags()" id="toggle-uitags-btn" class="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-indigo-300 border border-indigo-500/40 transition flex items-center gap-1.5 shadow" title="เปิด/ปิด ป้ายชื่อเรียกทางคอมพิวเตอร์">
          <span>🏷️</span>
          <span id="uitags-btn-text">ป้ายชื่อ UI (เปิดอยู่)</span>
        </button>
        <!-- UI/UX Glossary Button -->
        <button onclick="toggleUiGlossaryModal()" class="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition flex items-center gap-1.5" title="ดูคำอธิบายศัพท์ UI/UX">
          <span>📖</span>
          <span class="hidden sm:inline">ศัพท์ UI</span>
        </button>
        <button onclick="openManualsLibrary()" class="px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-950/80 hover:bg-indigo-900 text-indigo-300 border border-indigo-700/60 transition flex items-center gap-1.5 shadow-md">
          <span>📚</span>
          <span class="hidden sm:inline">คลังคู่มือ & ปก</span> (<span id="nav-manuals-count">${manualsCount}</span>)
        </button>
        <button onclick="toggleSettingsModal()" class="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition flex items-center gap-1.5">
          <span>⚙️</span>
          <span class="hidden sm:inline">ตั้งค่า / API</span>
        </button>
      </div>
    </div>
  </header>

  <!-- Main Container: Layout Main Area -->
  <main class="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
    
    <!-- Dashboard Status Grid: Container 4-Column Metric Cards -->
    <div class="relative">
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs font-bold text-slate-400 uppercase tracking-wider">📊 แผงควบคุมระบบ (Dashboard Metrics Grid)</span>
        <span class="ui-tag px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 font-mono text-[9px] cursor-pointer hover:bg-slate-700" onclick="copyUiTag('[Grid: DashboardMetrics]')">🏷️ [Grid: DashboardMetrics]</span>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        <!-- Card 1: API & Security Status -->
        <div class="bg-slate-900/70 border border-slate-800/80 rounded-2xl p-4 shadow-lg backdrop-blur space-y-2 relative group">
          <div class="flex items-center justify-between text-xs text-slate-400">
            <span class="font-medium">🛡️ Gemini API Key</span>
            <span class="ui-tag px-1.5 py-0.2 rounded bg-indigo-950 text-indigo-300 border border-indigo-700/60 font-mono text-[9px] cursor-pointer hover:bg-indigo-900" onclick="copyUiTag('[Card 1: StatusCard - Gemini API]')">🏷️ Card 1 (StatusCard)</span>
          </div>
          <div class="flex items-center justify-between">
            <span id="dash-key-badge" class="px-2 py-0.5 rounded-full text-[10px] font-bold border ${keyBadgeClass}">${keyLabel}</span>
          </div>
          <div id="dash-key-masked" class="text-xs font-mono font-bold text-indigo-300 truncate">${keyMasked}</div>
          <div class="text-[11px] text-slate-500">ซ่อนอัตโนมัติ ปลอดภัยเวลาแชร์จอ</div>
        </div>

        <!-- Card 2: Quota & Usage -->
        <div class="bg-slate-900/70 border border-slate-800/80 rounded-2xl p-4 shadow-lg backdrop-blur space-y-2 relative group">
          <div class="flex items-center justify-between text-xs text-slate-400">
            <span class="font-medium">📊 Quota วันนี้ (Free Tier)</span>
            <span class="ui-tag px-1.5 py-0.2 rounded bg-indigo-950 text-indigo-300 border border-indigo-700/60 font-mono text-[9px] cursor-pointer hover:bg-indigo-900" onclick="copyUiTag('[Card 2: MetricCard - Quota Daily Limit]')">🏷️ Card 2 (MetricCard)</span>
          </div>
          <div class="flex items-center justify-between">
            <div class="text-lg font-bold text-white flex items-baseline gap-1.5">
              <span id="dash-quota-used">${requestsToday}</span>
              <span class="text-xs text-slate-500 font-normal">/ 1,500 คลิปต่อวัน</span>
            </div>
            <span class="text-emerald-400 font-bold text-xs">15 RPM</span>
          </div>
          <div class="w-full bg-slate-800 rounded-full h-1.5">
            <div id="dash-quota-bar" class="bg-indigo-500 h-1.5 rounded-full" style="width: 1%"></div>
          </div>
        </div>

        <!-- Card 3: Engine & Acceleration -->
        <div class="bg-slate-900/70 border border-slate-800/80 rounded-2xl p-4 shadow-lg backdrop-blur space-y-2 relative group">
          <div class="flex items-center justify-between text-xs text-slate-400">
            <span class="font-medium">⚡ Extractor & Hardware</span>
            <span class="ui-tag px-1.5 py-0.2 rounded bg-indigo-950 text-indigo-300 border border-indigo-700/60 font-mono text-[9px] cursor-pointer hover:bg-indigo-900" onclick="copyUiTag('[Card 3: EngineCard - Extractor & Hardware]')">🏷️ Card 3 (EngineCard)</span>
          </div>
          <div id="dash-engine-desc" class="text-xs font-bold text-slate-200 truncate" title="${hardware}">${hardware}</div>
          <div class="flex items-center justify-between text-[11px] text-slate-500">
            <span>ดึง Chapters & ซับไตเติลแม่นยำ</span>
            <span id="dash-ytdlp-badge" class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-800">yt-dlp พร้อม</span>
          </div>
        </div>

        <!-- Card 4: Library Count -->
        <div class="bg-slate-900/70 border border-slate-800/80 rounded-2xl p-4 shadow-lg backdrop-blur space-y-2 relative group">
          <div class="flex items-center justify-between text-xs text-slate-400">
            <span class="font-medium">📁 คลังคู่มือแยกหมวดหมู่</span>
            <span class="ui-tag px-1.5 py-0.2 rounded bg-indigo-950 text-indigo-300 border border-indigo-700/60 font-mono text-[9px] cursor-pointer hover:bg-indigo-900" onclick="copyUiTag('[Card 4: CatalogCard - Manuals Counter]')">🏷️ Card 4 (CatalogCard)</span>
          </div>
          <div class="flex items-center justify-between">
            <div class="text-lg font-bold text-white flex items-baseline gap-1.5">
              <span id="dash-manuals-count">${manualsCount}</span>
              <span class="text-xs text-slate-500 font-normal">คู่มือพร้อมรูปปก</span>
            </div>
            <span class="text-xs text-indigo-400 cursor-pointer hover:underline" onclick="openManualsLibrary()">ดูคลังปก &rarr;</span>
          </div>
          <div class="text-[11px] text-slate-500">จัดกลุ่มตามคอร์ส/เรื่องอัตโนมัติ</div>
        </div>

      </div>
    </div>

    <!-- Generator Box: Input Form Controller -->
    <div class="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-6 sm:p-8 shadow-2xl backdrop-blur-xl space-y-6 relative">
      
      <!-- Section Tag -->
      <div class="flex items-center justify-between border-b border-slate-800 pb-3">
        <div class="flex items-center gap-2">
          <h2 class="text-sm font-bold text-white flex items-center gap-2">
            <span>⚡</span> กล่องรับข้อมูลและควบคุมการสร้าง (Input Form & Generator Box)
          </h2>
          <span class="ui-tag px-2 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-700 font-mono text-[9px] cursor-pointer hover:bg-purple-900" onclick="copyUiTag('[Section: GeneratorBox - Input Form Controller]')">🏷️ [Section: GeneratorBox]</span>
        </div>
        <button onclick="fillDemoUrl()" class="px-3 py-1 bg-indigo-950/80 hover:bg-indigo-900 text-indigo-300 border border-indigo-700/60 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 shadow">
          <span>⚡</span> <span>ลองคลิปตัวอย่าง (1-Click Demo)</span>
          <span class="ui-tag px-1 rounded bg-slate-900 text-slate-400 text-[8px]" onclick="event.stopPropagation(); copyUiTag('[Button: 1-Click-Demo-Action]')">#DemoBtn</span>
        </button>
      </div>

      <!-- Input Tabs -->
      <div class="flex space-x-4 border-b border-slate-800/80 pb-2">
        <button id="tab-yt-btn" onclick="switchInputTab('yt')" class="pb-2 text-sm font-semibold border-b-2 border-indigo-500 text-indigo-400 flex items-center gap-2">
          <span>🎥</span> YouTube URL / Playlist
          <span class="ui-tag px-1.5 rounded bg-slate-800 text-slate-400 text-[8px] font-mono" onclick="event.stopPropagation(); copyUiTag('[Tab 1: YouTube-URL-Input-Tab]')">#Tab-YouTube</span>
        </button>
        <button id="tab-sub-btn" onclick="switchInputTab('sub')" class="pb-2 text-sm font-semibold border-b-2 border-transparent text-slate-400 hover:text-slate-200 flex items-center gap-2">
          <span>📝</span> Subtitle / VTT / SRT
          <span class="ui-tag px-1.5 rounded bg-slate-800 text-slate-400 text-[8px] font-mono" onclick="event.stopPropagation(); copyUiTag('[Tab 2: Subtitle-Direct-Input-Tab]')">#Tab-Subtitle</span>
        </button>
      </div>

      <!-- Tab 1: YouTube Input -->
      <div id="tab-yt-content" class="space-y-4">
        <div>
          <div class="flex items-center justify-between mb-1.5">
            <label class="block text-xs font-semibold text-slate-300 uppercase tracking-wider">วางลิงก์ YouTube Video หรือ Playlist (กด Enter หรือกดปุ่มสร้างได้ทันที)</label>
            <span class="ui-tag text-[9px] font-mono text-slate-500 cursor-pointer" onclick="copyUiTag('[Input: YouTube-URL-InputField]')">🏷️ #Input: yt-url-input</span>
          </div>
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
      <div id="progress-stepper-box" class="hidden rounded-xl bg-slate-950/90 border border-indigo-500/40 p-5 space-y-4 shadow-xl relative">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="text-xs font-bold text-indigo-300 flex items-center gap-2">
              <span class="animate-spin text-sm">🌀</span>
              <span id="stepper-main-status">กำลังดำเนินการ...</span>
            </span>
            <span class="ui-tag px-1.5 py-0.2 rounded bg-cyan-950 text-cyan-300 border border-cyan-700 font-mono text-[9px] cursor-pointer" onclick="copyUiTag('[Component: ProgressStepper - Multi-Step Timeline]')">🏷️ [Component: ProgressStepper]</span>
          </div>
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
          <span class="ui-tag px-1.5 rounded bg-slate-950/80 text-pink-300 font-mono text-[9px]" onclick="event.stopPropagation(); copyUiTag('[Button: GenerateManualAction - Primary CTA]')">#CTA-Button</span>
        </button>
      </div>

      <!-- Enhanced Error Diagnostic Box with 1-Click Copy -->
      <div id="error-diagnostic-box" class="hidden rounded-xl bg-rose-950/70 border border-rose-800/90 p-5 space-y-3 shadow-2xl relative">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2 text-rose-300 font-bold text-xs">
            <span class="text-base">⚠️</span>
            <span id="error-title-text">เกิดข้อผิดพลาดในการประมวลผล</span>
            <span class="ui-tag px-1.5 py-0.2 rounded bg-rose-900 text-rose-200 border border-rose-600 font-mono text-[9px] cursor-pointer" onclick="copyUiTag('[Alert: ErrorDiagnostics - Troubleshooting Card]')">🏷️ [Alert: ErrorDiagnostics]</span>
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
            <span class="ui-tag px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 font-mono text-[9px]" onclick="event.stopPropagation(); copyUiTag('[Console: ActivityTerminal - Live Event Logger]')">🏷️ [Console: ActivityTerminal]</span>
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

    <!-- Manuals Library Section: Categorized Course Bookshelf -->
    <div id="manuals-library-section" class="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-6 shadow-2xl relative">
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <div class="flex items-center gap-2">
            <h2 class="text-lg font-bold text-white flex items-center gap-2">
              <span>📚</span> คลังคู่มือแยกตามหมวดหมู่ & รายการคลิป
            </h2>
            <span class="ui-tag px-2 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-700 font-mono text-[9px] cursor-pointer hover:bg-blue-900" onclick="copyUiTag('[Section: CatalogGrid - Categorized Course Bookshelf]')">🏷️ [Section: CatalogGrid]</span>
          </div>
          <p class="text-xs text-slate-400 mt-1">คลิกที่แถวหรือการ์ดเพื่อ <strong>ดูรายละเอียดฉบับย่อ & สารบัญ</strong> หรือเปิดอ่านฉบับเต็มได้ทันที</p>
        </div>
        <div class="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <!-- View Mode Switcher: List vs Grid -->
          <div class="flex rounded-xl bg-slate-950 border border-slate-800 p-0.5 shadow-inner">
            <button id="view-mode-list-btn" onclick="setViewMode('list')" class="px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 text-white transition flex items-center gap-1.5 shadow" title="แสดงแบบแถวบรรทัดละคลิป (ช่องตรงกันเป็นระเบียบ)">
              <span>☰</span> <span>แถวเรียง</span>
            </button>
            <button id="view-mode-grid-btn" onclick="setViewMode('grid')" class="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-slate-200 transition flex items-center gap-1.5" title="แสดงแบบการ์ดตาราง">
              <span>🔲</span> <span>ตารางการ์ด</span>
            </button>
          </div>
          <input id="manual-search-input" oninput="filterManualsGrid()" type="text" placeholder="🔍 ค้นหาคู่มือ / ชื่อคอร์ส..." 
            class="bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:ring-2 focus:ring-indigo-500 w-full sm:w-52" />
        </div>
      </div>

      <!-- Category Filter Tabs (Filter Pills) -->
      <div id="manual-category-tabs" class="flex flex-wrap gap-2">
        <!-- Rendered dynamically -->
      </div>

      <!-- Cards & Rows Container (Catalog Grid / List) -->
      <div id="manuals-grid-container" class="space-y-2.5">
        <!-- Rendered dynamically -->
      </div>
    </div>

    <!-- Output Display Area: Reading View / Markdown Viewer -->
    <div id="output-container" class="hidden space-y-6">
      
      <!-- Output Actions Header (Toolbar) -->
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-slate-900/90 border border-slate-800 p-5 rounded-2xl shadow-xl sticky top-20 z-40 backdrop-blur-xl">
        <div>
          <div class="flex items-center gap-2 mb-1">
            <span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-indigo-950 text-indigo-300 border border-indigo-800">Reading View</span>
            <span class="ui-tag px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-300 border border-emerald-700 font-mono text-[9px] cursor-pointer" onclick="copyUiTag('[Section: ReadingView - Markdown Document Viewer]')">🏷️ [Section: ReadingView]</span>
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

      <!-- Output View: Document Layout -->
      <div id="manual-view" class="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 sm:p-10 space-y-8 shadow-2xl">
        <!-- Rendered dynamically -->
      </div>
    </div>

  </main>

  <!-- Interactive Course Details Modal (Professional Metadata & TOC Drawer) -->
  <div id="manual-details-modal" class="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-50 flex items-center justify-center p-4 hidden">
    <div class="bg-slate-900 border border-slate-800 rounded-2xl max-w-3xl w-full p-6 sm:p-8 space-y-6 shadow-2xl max-h-[90vh] overflow-y-auto relative">
      
      <!-- Modal Header -->
      <div class="flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <div class="flex flex-wrap items-center gap-2 mb-2">
            <span id="modal-episode-badge" class="px-2.5 py-0.5 rounded-md text-xs font-bold bg-indigo-950 text-indigo-300 border border-indigo-800"></span>
            <span id="modal-topic-badge" class="px-2.5 py-0.5 rounded-md text-xs font-medium bg-slate-800 text-slate-300 border border-slate-700"></span>
            <span id="modal-created-badge" class="text-xs text-slate-500 font-mono"></span>
          </div>
          <h2 id="modal-manual-title" class="text-xl font-bold text-white tracking-tight leading-snug"></h2>
        </div>
        <button onclick="closeManualDetailsModal()" class="text-slate-400 hover:text-slate-200 text-2xl font-bold p-1">&times;</button>
      </div>

      <!-- Modal Body: 2-Column Overview & Specs -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        <!-- Left Column: Video Thumbnail Preview -->
        <div class="space-y-3">
          <div class="relative aspect-video rounded-xl overflow-hidden bg-slate-950 border border-slate-800 shadow-md">
            <img id="modal-thumbnail" src="" alt="Cover" class="w-full h-full object-cover">
          </div>
          <div id="modal-yt-btn-container"></div>
        </div>

        <!-- Right Column: Executive Overview & Metrics -->
        <div class="md:col-span-2 space-y-4">
          <div>
            <h4 class="text-xs font-bold text-indigo-400 uppercase tracking-wider mb-1 flex items-center gap-1.5">
              <span>🎯</span> ภาพรวมและจุดประสงค์การใช้งาน
            </h4>
            <p id="modal-overview-text" class="text-xs text-slate-300 leading-relaxed bg-slate-950/60 border border-slate-800/80 p-3.5 rounded-xl"></p>
          </div>

          <!-- Quick Metrics Bar -->
          <div class="grid grid-cols-3 gap-2">
            <div class="bg-slate-950/60 border border-slate-800 p-3 rounded-xl text-center">
              <div class="text-[10px] text-slate-500 uppercase font-semibold">ขั้นตอน (Steps)</div>
              <div id="modal-steps-count" class="text-base font-bold text-indigo-300 mt-0.5">0</div>
            </div>
            <div class="bg-slate-950/60 border border-slate-800 p-3 rounded-xl text-center">
              <div class="text-[10px] text-slate-500 uppercase font-semibold">เวลาอ่านโดยประมาณ</div>
              <div id="modal-read-time" class="text-base font-bold text-emerald-300 mt-0.5">~3 นาที</div>
            </div>
            <div class="bg-slate-950/60 border border-slate-800 p-3 rounded-xl text-center">
              <div class="text-[10px] text-slate-500 uppercase font-semibold">ขนาดไฟล์</div>
              <div id="modal-file-size" class="text-base font-bold text-purple-300 mt-0.5">0 KB</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Quick Table of Contents / Step Preview -->
      <div>
        <h4 class="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <span>📑</span> สารบัญขั้นตอนการทำงาน (Table of Contents)
        </h4>
        <div id="modal-toc-container" class="space-y-1.5 max-h-48 overflow-y-auto pr-1"></div>
      </div>

      <!-- Modal Footer Toolbar with Delete Button -->
      <div class="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-slate-800">
        <div class="flex items-center gap-3">
          <div class="text-xs text-slate-500 font-mono" id="modal-file-path"></div>
          <button id="modal-delete-btn" class="px-3 py-1.5 bg-rose-950/80 hover:bg-rose-900 border border-rose-800 text-rose-300 text-xs font-semibold rounded-lg transition flex items-center gap-1 shadow">
            <span>🗑️</span> <span>ลบคู่มือนี้</span>
          </button>
        </div>
        <div class="flex items-center gap-2">
          <button onclick="closeManualDetailsModal()" class="px-4 py-2 text-xs font-semibold rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 transition">
            ปิด
          </button>
          <button id="modal-open-full-btn" class="px-5 py-2 text-xs font-bold rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white transition flex items-center gap-1.5 shadow-lg shadow-indigo-500/25">
            <span>📖</span> <span>เปิดอ่านคู่มือฉบับเต็ม</span>
          </button>
        </div>
      </div>

    </div>
  </div>

  <!-- Settings Modal: Dialog / Modal Window -->
  <div id="settings-modal" class="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 hidden">
    <div class="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-5 shadow-2xl relative">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <h3 class="text-base font-bold text-white flex items-center gap-2">
            <span>⚙️</span> การตั้งค่า & ความปลอดภัย API Key
          </h3>
          <span class="ui-tag px-1.5 py-0.2 rounded bg-indigo-950 text-indigo-300 border border-indigo-700 font-mono text-[9px] cursor-pointer" onclick="copyUiTag('[Modal: SettingsDialog - Config Window]')">🏷️ [Modal: SettingsDialog]</span>
        </div>
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

  <!-- UI/UX Glossary Modal: Engineering Reference -->
  <div id="glossary-modal" class="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-50 flex items-center justify-center p-4 hidden">
    <div class="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full p-6 sm:p-8 space-y-5 shadow-2xl max-h-[85vh] overflow-y-auto">
      <div class="flex items-center justify-between border-b border-slate-800 pb-3">
        <h3 class="text-base font-bold text-white flex items-center gap-2">
          <span>📖</span> พจนานุกรมศัพท์ UI/UX & โครงสร้างหน้าจอ (Computer Component Names)
        </h3>
        <button onclick="toggleUiGlossaryModal()" class="text-slate-400 hover:text-slate-200 text-xl font-bold">&times;</button>
      </div>

      <p class="text-xs text-slate-300 leading-relaxed">
        ในทางวิศวกรรมคอมพิวเตอร์และเว็บ หน้าจอโปรแกรมถูกแบ่งเป็นชิ้นส่วน (Components) ท่านสามารถคลิกที่ป้าย <strong>🏷️ [Tag Name]</strong> ในหน้าเว็บ เพื่อคัดลอกชื่อไปบอก AI ได้ทันทีครับ:
      </p>

      <div class="overflow-x-auto border border-slate-800 rounded-xl">
        <table class="w-full text-left text-xs">
          <thead class="bg-slate-950 text-slate-400 uppercase font-semibold border-b border-slate-800">
            <tr>
              <th class="p-3">ชื่อเรียกทางคอมพิวเตอร์</th>
              <th class="p-3">ความหมาย / หน้าที่</th>
              <th class="p-3">ตำแหน่งในหน้านี้</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-800 text-slate-300">
            <tr class="hover:bg-slate-800/40">
              <td class="p-3 font-mono text-indigo-300 font-bold">Navbar (Header)</td>
              <td class="p-3">แถบนำทางส่วนบนสุดของแอป สำหรับใส่โลโก้และปุ่มลัด</td>
              <td class="p-3 text-slate-400">ด้านบนสุด</td>
            </tr>
            <tr class="hover:bg-slate-800/40">
              <td class="p-3 font-mono text-indigo-300 font-bold">Metric Card / Stat Card</td>
              <td class="p-3">การ์ดสี่เหลี่ยมแสดงตัวเลขสรุปหรือสถานะฮาร์ดแวร์/โควตา</td>
              <td class="p-3 text-slate-400">Card 1 ถึง Card 4</td>
            </tr>
            <tr class="hover:bg-slate-800/40">
              <td class="p-3 font-mono text-indigo-300 font-bold">Input Form / Controller Box</td>
              <td class="p-3">กล่องรับข้อมูลสำหรับพิมพ์ข้อความ/วางลิงก์และปุ่ม Action</td>
              <td class="p-3 text-slate-400">กล่องวางลิงก์ YouTube</td>
            </tr>
            <tr class="hover:bg-slate-800/40">
              <td class="p-3 font-mono text-indigo-300 font-bold">Tab Navigation</td>
              <td class="p-3">ปุ่มสลับหน้าย่อยในกรอบเดียวกัน (เช่น สลับ YouTube / Subtitle)</td>
              <td class="p-3 text-slate-400">เหนือช่องกรอก URL</td>
            </tr>
            <tr class="hover:bg-slate-800/40">
              <td class="p-3 font-mono text-indigo-300 font-bold">Progress Stepper</td>
              <td class="p-3">ไทม์ไลน์แสดงสเต็ป 1-2-3 ว่าตอนนี้งานวิ่งถึงขั้นตอนไหน</td>
              <td class="p-3 text-slate-400">กล่องหมุนสีครามเวลาสร้าง</td>
            </tr>
            <tr class="hover:bg-slate-800/40">
              <td class="p-3 font-mono text-indigo-300 font-bold">Console Terminal / Log Stream</td>
              <td class="p-3">กล่องข้อความบันทึกเหตุการณ์สดและเวลาเหมือนหน้าจอโปรแกรมเมอร์</td>
              <td class="p-3 text-slate-400">Live Activity Log ด้านล่าง</td>
            </tr>
            <tr class="hover:bg-slate-800/40">
              <td class="p-3 font-mono text-indigo-300 font-bold">Catalog Grid / Card Bookshelf</td>
              <td class="p-3">ตะแกรงเรียงการ์ดคู่มือพร้อมรูปปก (Card Layout)</td>
              <td class="p-3 text-slate-400">คลังคู่มือ & รูปปกตัวอย่าง</td>
            </tr>
            <tr class="hover:bg-slate-800/40">
              <td class="p-3 font-mono text-indigo-300 font-bold">Reading View / Markdown Viewer</td>
              <td class="p-3">มุมมองเปิดอ่านเอกสารคู่มือพร้อมแถบ Toolbar</td>
              <td class="p-3 text-slate-400">หน้ารายละเอียดคู่มือ</td>
            </tr>
            <tr class="hover:bg-slate-800/40">
              <td class="p-3 font-mono text-indigo-300 font-bold">Modal Dialog</td>
              <td class="p-3">หน้าต่างป๊อปอัปที่เด้งซ้อนขึ้นมาเพื่อตั้งค่าหรือดูรายละเอียด</td>
              <td class="p-3 text-slate-400">หน้าต่างตั้งค่า & รายละเอียดคู่มือ</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="flex justify-end pt-2 border-t border-slate-800">
        <button onclick="toggleUiGlossaryModal()" class="px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-500">เข้าใจแล้ว</button>
      </div>
    </div>
  </div>

  <!-- Floating Quick Scroll Navigator Widget (⬆️ Top / ⬇️ Bottom) -->
  <div id="floating-scroll-nav" class="fixed bottom-6 right-6 z-40 flex flex-col gap-2 shadow-2xl">
    <button onclick="scrollToTop()" class="h-10 w-10 rounded-xl bg-slate-900/90 hover:bg-indigo-600 border border-slate-700/80 hover:border-indigo-500 text-slate-300 hover:text-white flex items-center justify-center transition shadow-lg backdrop-blur-md group" title="ขึ้นบนสุด (Scroll to Top)">
      <span class="text-sm group-hover:-translate-y-0.5 transition">▲</span>
    </button>
    <button onclick="openManualsLibrary()" class="h-10 w-10 rounded-xl bg-slate-900/90 hover:bg-indigo-600 border border-slate-700/80 hover:border-indigo-500 text-slate-300 hover:text-white flex items-center justify-center transition shadow-lg backdrop-blur-md group" title="ไปที่คลังคู่มือ (Catalog Bookshelf)">
      <span class="text-xs group-hover:scale-110 transition">📚</span>
    </button>
    <button onclick="scrollToBottom()" class="h-10 w-10 rounded-xl bg-slate-900/90 hover:bg-indigo-600 border border-slate-700/80 hover:border-indigo-500 text-slate-300 hover:text-white flex items-center justify-center transition shadow-lg backdrop-blur-md group" title="ลงล่างสุด (Scroll to Bottom)">
      <span class="text-sm group-hover:translate-y-0.5 transition">▼</span>
    </button>
  </div>

  <!-- Toast Notification Container -->
  <div id="ui-toast" class="fixed bottom-6 left-6 bg-indigo-950 border border-indigo-500 text-indigo-200 px-4 py-2.5 rounded-xl text-xs font-bold shadow-2xl z-50 hidden flex items-center gap-2">
    <span>📋</span>
    <span id="ui-toast-msg">คัดลอกชื่อชิ้นส่วนแล้ว!</span>
  </div>

  <!-- Footer -->
  <footer class="border-t border-slate-800/80 py-6 text-center text-xs text-slate-500 space-y-1">
    <p>ClipToManual &copy; 2026 - Governed by Oxlint & TypeScript Strict Quality Gate</p>
    <p class="text-[11px] text-slate-600">Free Tier: 15 RPM / 1,500 Requests/Day &bull; High-Performance Automation</p>
  </footer>

  <script src="/app.js"></script>
</body>
</html>`;
}
