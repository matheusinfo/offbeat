// Parses one yt-dlp output line, as emitted by the backend's arguments:
//   PROG {json}            --progress-template "download:PROG %(progress)j"
//   POST <name> <status>   postprocessor hook
//   DONE <filepath>        --print "after_move:DONE %(filepath)s"

export interface ProgressEvent {
  type: 'progress';
  downloaded: number | null;
  total: number | null;
  /** Bytes per second. */
  speed: number | null;
  /** Seconds. */
  eta: number | null;
  /** yt-dlp status: "downloading", "finished", "error"... */
  status: string | null;
  /** 0..1 when it can be computed (bytes, else fragments), else null. */
  fraction: number | null;
}

export interface PostprocessEvent {
  type: 'postprocess';
  name: string;
  status: string;
}

export interface DoneEvent {
  type: 'done';
  filepath: string;
}

export type LineEvent = ProgressEvent | PostprocessEvent | DoneEvent;

export function parseLine(rawLine: string): LineEvent | null {
  // Drop leading whitespace and a trailing CR/LF (stderr may carry \r).
  const line = rawLine.replace(/^\s+/, '').replace(/[\r\n]+$/, '');
  if (line.startsWith('PROG ')) return parseProgress(line.slice(5));
  if (line.startsWith('POST ')) return parsePostprocess(line.slice(5));
  if (line.startsWith('DONE ')) {
    const filepath = line.slice(5);
    return filepath.trim() === '' ? null : { type: 'done', filepath };
  }
  return null;
}

function parsePostprocess(rest: string): PostprocessEvent | null {
  const parts = rest.trim().split(/\s+/);
  const [name, status] = parts;
  if (parts.length !== 2 || name === undefined || status === undefined) return null;
  return { type: 'postprocess', name, status };
}

function parseProgress(json: string): ProgressEvent | null {
  const data = parseLooseJson(json);
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  const obj = data as Record<string, unknown>;

  const downloaded = nonNegative(obj['downloaded_bytes']);
  const total = positive(obj['total_bytes']) ?? positive(obj['total_bytes_estimate']);
  const status = typeof obj['status'] === 'string' ? obj['status'] : null;

  let fraction: number | null = null;
  if (status === 'finished') {
    fraction = 1;
  } else if (downloaded !== null && total !== null) {
    fraction = clamp01(downloaded / total);
  } else {
    // HLS/DASH downloads may only know fragment counts.
    const index = nonNegative(obj['fragment_index']);
    const count = positive(obj['fragment_count']);
    if (index !== null && count !== null) fraction = clamp01(index / count);
  }

  return {
    type: 'progress',
    downloaded,
    total,
    speed: nonNegative(obj['speed']),
    eta: nonNegative(obj['eta']),
    status,
    fraction,
  };
}

/**
 * JSON.parse, but tolerant of the NaN/Infinity tokens Python's json.dumps
 * emits by default. Tokens inside strings (e.g. a title "NaN") are kept.
 */
export function parseLooseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    try {
      return JSON.parse(replaceNonFiniteTokens(text));
    } catch {
      return null;
    }
  }
}

function replaceNonFiniteTokens(text: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += text.charAt(i + 1);
        i++;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    const token = matchToken(text, i);
    if (token !== null) {
      out += 'null';
      i += token.length - 1;
      continue;
    }
    out += ch;
  }
  return out;
}

function matchToken(text: string, i: number): string | null {
  for (const token of ['-Infinity', 'Infinity', 'NaN']) {
    if (text.startsWith(token, i)) return token;
  }
  return null;
}

function finite(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function nonNegative(v: unknown): number | null {
  const n = finite(v);
  return n !== null && n >= 0 ? n : null;
}

function positive(v: unknown): number | null {
  const n = finite(v);
  return n !== null && n > 0 ? n : null;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}
