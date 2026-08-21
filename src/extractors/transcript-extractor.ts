import type { TranscriptSegment, VideoMetadata } from '../types/manual.js';
import { formatTimestamp } from './youtube-url.js';

export interface ExtractedTranscriptResult {
  readonly success: boolean;
  readonly segments: readonly TranscriptSegment[];
  readonly fullText: string;
  readonly metadata?: VideoMetadata;
  readonly error?: string;
}

export async function extractYouTubeTranscript(videoId: string): Promise<ExtractedTranscriptResult> {
  try {
    const videoUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
    const response = await fetch(videoUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9,th;q=0.8'
      }
    });

    if (!response.ok) {
      return {
        success: false,
        segments: [],
        fullText: '',
        error: `Failed to fetch YouTube page (HTTP ${response.status})`
      };
    }

    const html = await response.text();

    // Extract title
    const titleMatch = /<title>(.*?) - YouTube<\/title>/.exec(html) ?? /<meta name="title" content="(.*?)">/.exec(html);
    const rawTitle = titleMatch?.[1] ? decodeHtmlEntities(titleMatch[1]) : `YouTube Video (${videoId})`;

    // Extract captionTracks from ytInitialPlayerResponse
    const playerResponseMatch = html.match(/ytInitialPlayerResponse\s*=\s*({.+?});(?:var|\n|<\/script>)/);
    let captionTracks: Array<{ baseUrl: string; languageCode?: string; name?: { simpleText?: string } }> = [];

    if (playerResponseMatch?.[1]) {
      try {
        const playerJson = JSON.parse(playerResponseMatch[1]) as {
          captions?: {
            playerCaptionsTracklistRenderer?: {
              captionTracks?: Array<{ baseUrl: string; languageCode?: string; name?: { simpleText?: string } }>;
            };
          };
          videoDetails?: {
            title?: string;
            author?: string;
            lengthSeconds?: string;
          };
        };

        captionTracks = playerJson.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
      } catch {
        // Fallback to regex
      }
    }

    // Fallback: search captionTracks directly in html
    if (captionTracks.length === 0) {
      const captionRegex = /"captionTracks":(\[.+?\])/;
      const match = captionRegex.exec(html);
      if (match?.[1]) {
        try {
          captionTracks = JSON.parse(match[1]) as Array<{ baseUrl: string; languageCode?: string }>;
        } catch {
          // ignore
        }
      }
    }

    if (captionTracks.length === 0) {
      return {
        success: false,
        segments: [],
        fullText: '',
        metadata: {
          videoId,
          title: rawTitle
        },
        error: 'No captions found for this video. You can paste custom subtitles (.vtt / .srt / text) in the input box below.'
      };
    }

    // Prefer Thai (th / th-orig) or English (en) track, or first track
    const selectedTrack =
      captionTracks.find((t) => t.languageCode === 'th' || t.languageCode === 'th-orig') ??
      captionTracks.find((t) => t.languageCode === 'en' || t.languageCode?.startsWith('en-')) ??
      captionTracks[0];

    if (!selectedTrack?.baseUrl) {
      return {
        success: false,
        segments: [],
        fullText: '',
        metadata: { videoId, title: rawTitle },
        error: 'Caption track URL was empty.'
      };
    }

    // Attempt 1: Fetch as VTT format
    const vttUrl = selectedTrack.baseUrl.includes('fmt=')
      ? selectedTrack.baseUrl
      : `${selectedTrack.baseUrl}&fmt=vtt`;

    let segments: TranscriptSegment[] = [];

    try {
      const vttRes = await fetch(vttUrl);
      if (vttRes.ok) {
        const vttText = await vttRes.text();
        segments = parseVttOrSrt(vttText);
      }
    } catch {
      // ignore and fallback
    }

    // Attempt 2: If VTT parsing had 0 segments, fetch raw baseUrl and parse XML
    if (segments.length === 0) {
      const transcriptResponse = await fetch(selectedTrack.baseUrl);
      if (transcriptResponse.ok) {
        const xmlText = await transcriptResponse.text();
        segments = parseTimedTextXml(xmlText);
        if (segments.length === 0) {
          segments = parseVttOrSrt(xmlText);
        }
      }
    }

    if (segments.length === 0) {
      return {
        success: false,
        segments: [],
        fullText: '',
        metadata: { videoId, title: rawTitle },
        error: 'Transcript could not be parsed.'
      };
    }

    const fullText = segments.map((s) => `[${s.formattedTime}] ${s.text}`).join('\n');

    return {
      success: true,
      segments,
      fullText,
      metadata: {
        videoId,
        title: rawTitle,
        thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
      }
    };
  } catch (error) {
    const errMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      segments: [],
      fullText: '',
      error: `Error extracting transcript: ${errMessage}`
    };
  }
}

export function parseTimedTextXml(xml: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];

  // Match <text start="1.5" dur="2.0">text</text>
  const textRegex = /<text\s+start="([\d.]+)"(?:\s+dur="([\d.]+)")?[^>]*>(.*?)<\/text>/gi;
  let match: RegExpExecArray | null = textRegex.exec(xml);
  while (match !== null) {
    const startSec = parseFloat(match[1] ?? '0');
    const durSec = parseFloat(match[2] ?? '0');
    const rawContent = match[3] ?? '';
    const cleanText = decodeHtmlEntities(rawContent.replace(/<[^>]+>/g, '')).trim();

    if (cleanText.length > 0) {
      segments.push({
        start: startSec,
        duration: durSec,
        text: cleanText,
        formattedTime: formatTimestamp(startSec)
      });
    }

    match = textRegex.exec(xml);
  }

  // If no <text> found, match <p t="1500" d="2000"> (milliseconds)
  if (segments.length === 0) {
    const pRegex = /<p\s+t="(\d+)"(?:\s+d="(\d+)")?[^>]*>(.*?)<\/p>/gi;
    let pMatch: RegExpExecArray | null = pRegex.exec(xml);
    while (pMatch !== null) {
      const startMs = parseInt(pMatch[1] ?? '0', 10);
      const durMs = parseInt(pMatch[2] ?? '0', 10);
      const startSec = startMs / 1000;
      const durSec = durMs / 1000;
      const rawContent = pMatch[3] ?? '';
      const cleanText = decodeHtmlEntities(rawContent.replace(/<[^>]+>/g, '')).trim();

      if (cleanText.length > 0) {
        segments.push({
          start: startSec,
          duration: durSec,
          text: cleanText,
          formattedTime: formatTimestamp(startSec)
        });
      }

      pMatch = pRegex.exec(xml);
    }
  }

  return segments;
}

export function parseVttOrSrt(content: string): TranscriptSegment[] {
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const segments: TranscriptSegment[] = [];

  let currentStart = 0;
  let currentDur = 0;
  let currentTextLines: string[] = [];

  const timeRegex = /(?:(\d{2}):)?(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(?:(\d{2}):)?(\d{2}):(\d{2})[.,](\d{3})/;

  for (const line of lines) {
    const trimmed = line.trim();

    if (timeRegex.test(trimmed)) {
      if (currentTextLines.length > 0) {
        const text = decodeHtmlEntities(currentTextLines.join(' ').replace(/<[^>]+>/g, '')).trim();
        if (text.length > 0) {
          segments.push({
            start: currentStart,
            duration: currentDur,
            text,
            formattedTime: formatTimestamp(currentStart)
          });
        }
        currentTextLines = [];
      }

      const match = timeRegex.exec(trimmed);
      if (match) {
        const startHrs = parseInt(match[1] ?? '0', 10);
        const startMins = parseInt(match[2] ?? '0', 10);
        const startSecs = parseInt(match[3] ?? '0', 10);
        const startMs = parseInt(match[4] ?? '0', 10);

        const endHrs = parseInt(match[5] ?? '0', 10);
        const endMins = parseInt(match[6] ?? '0', 10);
        const endSecs = parseInt(match[7] ?? '0', 10);
        const endMs = parseInt(match[8] ?? '0', 10);

        currentStart = startHrs * 3600 + startMins * 60 + startSecs + startMs / 1000;
        const endTotal = endHrs * 3600 + endMins * 60 + endSecs + endMs / 1000;
        currentDur = Math.max(0, endTotal - currentStart);
      }
    } else if (trimmed.length > 0 && !trimmed.startsWith('WEBVTT') && !/^\d+$/.test(trimmed)) {
      currentTextLines.push(trimmed);
    }
  }

  if (currentTextLines.length > 0) {
    const text = decodeHtmlEntities(currentTextLines.join(' ').replace(/<[^>]+>/g, '')).trim();
    if (text.length > 0) {
      segments.push({
        start: currentStart,
        duration: currentDur,
        text,
        formattedTime: formatTimestamp(currentStart)
      });
    }
  }

  return segments;
}

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
}
