export interface ParsedYouTubeUrl {
  readonly isValid: boolean;
  readonly videoId?: string;
  readonly playlistId?: string;
  readonly isPlaylist: boolean;
  readonly isShort: boolean;
  readonly startSeconds?: number;
}

export function parseYouTubeUrl(url: string): ParsedYouTubeUrl {
  if (!url || typeof url !== 'string') {
    return { isValid: false, isPlaylist: false, isShort: false };
  }

  const cleanUrl = url.trim();

  try {
    const parsed = new URL(cleanUrl);
    const hostname = parsed.hostname.toLowerCase();

    // Check for short URL (youtu.be/ID)
    if (hostname === 'youtu.be') {
      const videoId = parsed.pathname.slice(1).split('/')[0];
      const startSeconds = parseTimeParam(parsed.searchParams.get('t'));
      if (videoId && videoId.length > 0) {
        return {
          isValid: true,
          videoId,
          isPlaylist: false,
          isShort: false,
          startSeconds
        };
      }
    }

    // Check standard YouTube domains
    if (hostname === 'www.youtube.com' || hostname === 'youtube.com' || hostname === 'm.youtube.com') {
      // Playlist URL
      const playlistId = parsed.searchParams.get('list');
      if (parsed.pathname === '/playlist' && playlistId) {
        return {
          isValid: true,
          playlistId,
          isPlaylist: true,
          isShort: false
        };
      }

      // YouTube Shorts
      if (parsed.pathname.startsWith('/shorts/')) {
        const videoId = parsed.pathname.replace('/shorts/', '').split('/')[0];
        if (videoId && videoId.length > 0) {
          return {
            isValid: true,
            videoId,
            isPlaylist: false,
            isShort: true
          };
        }
      }

      // Standard watch URL
      const videoId = parsed.searchParams.get('v');
      const startSeconds = parseTimeParam(parsed.searchParams.get('t'));
      if (videoId && videoId.length > 0) {
        return {
          isValid: true,
          videoId,
          playlistId: playlistId ?? undefined,
          isPlaylist: Boolean(playlistId),
          isShort: false,
          startSeconds
        };
      }
    }

    // Raw video ID (11 alphanumeric characters + _ -)
    if (/^[a-zA-Z0-9_-]{11}$/.test(cleanUrl)) {
      return {
        isValid: true,
        videoId: cleanUrl,
        isPlaylist: false,
        isShort: false
      };
    }
  } catch {
    // Check if raw ID was passed directly
    if (/^[a-zA-Z0-9_-]{11}$/.test(cleanUrl)) {
      return {
        isValid: true,
        videoId: cleanUrl,
        isPlaylist: false,
        isShort: false
      };
    }
  }

  return { isValid: false, isPlaylist: false, isShort: false };
}

function parseTimeParam(timeParam: string | null): number | undefined {
  if (!timeParam) {
    return undefined;
  }

  // numeric seconds
  const numeric = Number(timeParam);
  if (!Number.isNaN(numeric) && numeric >= 0) {
    return numeric;
  }

  // format like 1h2m30s or 2m30s
  let totalSeconds = 0;
  const hoursMatch = /(\d+)h/i.exec(timeParam);
  const minutesMatch = /(\d+)m/i.exec(timeParam);
  const secondsMatch = /(\d+)s/i.exec(timeParam);

  if (hoursMatch?.[1]) {
    totalSeconds += parseInt(hoursMatch[1], 10) * 3600;
  }
  if (minutesMatch?.[1]) {
    totalSeconds += parseInt(minutesMatch[1], 10) * 60;
  }
  if (secondsMatch?.[1]) {
    totalSeconds += parseInt(secondsMatch[1], 10);
  }

  return totalSeconds > 0 ? totalSeconds : undefined;
}

export function formatTimestamp(seconds: number): string {
  if (Number.isNaN(seconds) || seconds < 0) {
    return '00:00';
  }

  const floorSeconds = Math.floor(seconds);
  const hrs = Math.floor(floorSeconds / 3600);
  const mins = Math.floor((floorSeconds % 3600) / 60);
  const secs = floorSeconds % 60;

  const paddedMins = String(mins).padStart(2, '0');
  const paddedSecs = String(secs).padStart(2, '0');

  if (hrs > 0) {
    const paddedHrs = String(hrs).padStart(2, '0');
    return `${paddedHrs}:${paddedMins}:${paddedSecs}`;
  }

  return `${paddedMins}:${paddedSecs}`;
}
