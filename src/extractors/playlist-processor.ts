import { spawn } from 'node:child_process';
import { getYtDlpExecutable, extractWithYtDlp, type YtDlpExtractionResult } from './yt-dlp-extractor.js';

export interface PlaylistItem {
  readonly index: number;
  readonly id: string;
  readonly title: string;
  readonly url: string;
}

export interface PlaylistExtractionProgress {
  readonly current: number;
  readonly total: number;
  readonly currentTitle: string;
  readonly status: 'extracting' | 'completed' | 'failed';
}

export async function getPlaylistVideos(playlistUrl: string): Promise<PlaylistItem[]> {
  const cmd = await getYtDlpExecutable();

  return new Promise((resolve, reject) => {
    const fullCommand = `${cmd} --flat-playlist -J "${playlistUrl}"`;
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
        try {
          const parsed = JSON.parse(stdout) as {
            entries?: Array<{ id?: string; title?: string; url?: string }>;
          };

          const items: PlaylistItem[] = (parsed.entries ?? []).map((entry, idx) => ({
            index: idx + 1,
            id: entry.id ?? '',
            title: entry.title ?? `Episode ${idx + 1}`,
            url: `https://www.youtube.com/watch?v=${entry.id ?? ''}`
          }));

          resolve(items);
        } catch (err) {
          reject(new Error(`Failed to parse playlist JSON: ${String(err)}`));
        }
      } else {
        reject(new Error(stderr || `yt-dlp exited with code ${code}`));
      }
    });

    proc.on('error', reject);
  });
}

export async function processEntirePlaylist(
  playlistUrl: string,
  onProgress?: (progress: PlaylistExtractionProgress) => void
): Promise<Array<{ item: PlaylistItem; result: YtDlpExtractionResult }>> {
  const videos = await getPlaylistVideos(playlistUrl);
  const results: Array<{ item: PlaylistItem; result: YtDlpExtractionResult }> = [];

  for (let i = 0; i < videos.length; i++) {
    const item = videos[i];
    if (!item) continue;

    onProgress?.({
      current: i + 1,
      total: videos.length,
      currentTitle: item.title,
      status: 'extracting'
    });

    const result = await extractWithYtDlp(item.url);
    results.push({ item, result });

    onProgress?.({
      current: i + 1,
      total: videos.length,
      currentTitle: item.title,
      status: result.success ? 'completed' : 'failed'
    });

    // Small delay between videos to respect rate-limits
    if (i < videos.length - 1) {
      await new Promise((res) => setTimeout(res, 2000));
    }
  }

  return results;
}
