import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { TranscriptSegment, VideoMetadata } from '../types/manual.js';
import { parseVttOrSrt } from './transcript-extractor.js';
import { parseYouTubeUrl } from './youtube-url.js';

export interface YtDlpChapter {
  readonly title: string;
  readonly startTime: number;
  readonly endTime: number;
}

export interface YtDlpVideoInfo {
  readonly id: string;
  readonly title: string;
  readonly uploader?: string;
  readonly duration?: number;
  readonly webpageUrl: string;
  readonly chapters?: readonly YtDlpChapter[];
}

export interface YtDlpExtractionResult {
  readonly success: boolean;
  readonly info?: YtDlpVideoInfo;
  readonly segments: readonly TranscriptSegment[];
  readonly fullText: string;
  readonly metadata?: VideoMetadata;
  readonly error?: string;
}

export async function getYtDlpExecutable(): Promise<string> {
  const localExe = path.join(process.cwd(), 'yt-dlp.exe');
  try {
    await fs.access(localExe);
    return localExe;
  } catch {
    return 'yt-dlp';
  }
}

export async function isYtDlpAvailable(): Promise<boolean> {
  const cmd = await getYtDlpExecutable();
  return new Promise((resolve) => {
    const proc = spawn(cmd, ['--version'], { shell: true });
    proc.on('error', () => resolve(false));
    proc.on('close', (code) => resolve(code === 0));
  });
}

export async function extractWithYtDlp(rawUrl: string): Promise<YtDlpExtractionResult> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clip-to-manual-'));
  const cmd = await getYtDlpExecutable();

  // Clean URL to avoid Windows shell & parsing issues
  const parsedUrl = parseYouTubeUrl(rawUrl);
  const cleanUrl = parsedUrl.videoId
    ? `https://www.youtube.com/watch?v=${encodeURIComponent(parsedUrl.videoId)}`
    : rawUrl.trim();

  let videoInfo: YtDlpVideoInfo | undefined;

  try {
    // 1. Fetch metadata and dump JSON
    try {
      const metadataOutput = await runCommandAsync(cmd, [
        '--dump-json',
        '--skip-download',
        '--no-playlist',
        `"${cleanUrl}"`
      ]);

      const parsed = JSON.parse(metadataOutput) as {
        id?: string;
        title?: string;
        uploader?: string;
        duration?: number;
        webpage_url?: string;
        chapters?: Array<{ title?: string; start_time?: number; end_time?: number }>;
      };

      videoInfo = {
        id: parsed.id ?? parsedUrl.videoId ?? '',
        title: parsed.title ?? 'Video',
        uploader: parsed.uploader,
        duration: parsed.duration,
        webpageUrl: parsed.webpage_url ?? cleanUrl,
        chapters: (parsed.chapters ?? []).map((ch) => ({
          title: ch.title ?? '',
          startTime: ch.start_time ?? 0,
          endTime: ch.end_time ?? 0
        }))
      };
    } catch {
      // ignore metadata failure and continue to subtitles
    }

    // 2. Download subtitles (prefer th-orig, th, en-orig, en)
    const outTemplate = path.join(tempDir, '%(id)s.%(ext)s');
    try {
      await runCommandAsync(cmd, [
        '--write-auto-sub',
        '--write-sub',
        '--sub-lang',
        'th-orig,th,en-orig,en,all',
        '--sub-format',
        'vtt',
        '--skip-download',
        '--no-playlist',
        '--ignore-errors',
        '-o',
        `"${outTemplate}"`,
        `"${cleanUrl}"`
      ]);
    } catch {
      // Subtitle downloader might log 429 on auto-translate but still download primary language
    }

    // 3. Find generated .vtt file by preference
    const files = await fs.readdir(tempDir);
    const vttFiles = files.filter((f) => f.endsWith('.vtt'));

    if (vttFiles.length === 0) {
      return {
        success: false,
        segments: [],
        fullText: '',
        info: videoInfo,
        metadata: videoInfo
          ? {
              videoId: videoInfo.id,
              title: videoInfo.title,
              author: videoInfo.uploader,
              lengthSeconds: videoInfo.duration
            }
          : undefined,
        error: 'yt-dlp found no subtitles/captions for this video.'
      };
    }

    // Sort by preferred language: th-orig > th > en-orig > en > first available
    const chosenFile =
      vttFiles.find((f) => f.includes('th-orig')) ??
      vttFiles.find((f) => f.includes('.th.')) ??
      vttFiles.find((f) => f.includes('en-orig')) ??
      vttFiles.find((f) => f.includes('.en.')) ??
      vttFiles[0];

    if (!chosenFile) {
      return {
        success: false,
        segments: [],
        fullText: '',
        error: 'Could not select a subtitle file.'
      };
    }

    const vttContent = await fs.readFile(path.join(tempDir, chosenFile), 'utf-8');
    const segments = parseVttOrSrt(vttContent);
    const fullText = segments.map((s) => `[${s.formattedTime}] ${s.text}`).join('\n');

    return {
      success: true,
      info: videoInfo,
      segments,
      fullText,
      metadata: {
        videoId: videoInfo?.id ?? parsedUrl.videoId ?? '',
        title: videoInfo?.title ?? 'Video',
        author: videoInfo?.uploader,
        lengthSeconds: videoInfo?.duration,
        thumbnailUrl: (videoInfo?.id ?? parsedUrl.videoId)
          ? `https://i.ytimg.com/vi/${videoInfo?.id ?? parsedUrl.videoId}/hqdefault.jpg`
          : undefined
      }
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      segments: [],
      fullText: '',
      error: `yt-dlp extraction failed: ${message}`
    };
  } finally {
    // Cleanup temporary directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

function runCommandAsync(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const fullCommand = `${command} ${args.join(' ')}`;
    const proc = spawn(fullCommand, { shell: true });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0 || stdout.length > 0) {
        resolve(stdout);
      } else {
        reject(new Error(stderr || `Process exited with code ${code}`));
      }
    });

    proc.on('error', reject);
  });
}
