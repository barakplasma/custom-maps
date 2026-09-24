// Vercel Function: hands out short-lived tokens so the browser can upload a shared map straight
// to Vercel Blob (the file never passes through this function). It enforces the quota that keeps
// the project inside the free Hobby allowance — going over blocks Blob for 30 days, which would
// break every shared link. Self-hosting later means replacing this file and publishKmz() in
// src/io/publish.ts; the app only depends on MAPS_URL/m/<id>.kmz for reading.
import { list } from '@vercel/blob';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';

// Hobby includes 1 GB storage and 2,000 advanced operations a month; each new upload costs 2
// (the list() below + the upload). These caps leave room for dashboard browsing.
export const LIMITS = {
  storageBytes: 600 * 1024 * 1024,
  uploadsPer30Days: 200,
  fileBytes: 3 * 1024 * 1024, // keep in sync with MAX_SHARE_BYTES in src/io/publish.ts
};

// Content-derived ids from src/core/mapName.ts: 8 characters, no look-alikes.
const PATHNAME = /^m\/[a-hj-km-np-z2-9]{8}\.kmz$/;
const DAY = 24 * 60 * 60 * 1000;

export function quotaProblem(blobs: { size: number; uploadedAt: Date }[], now: number): string | null {
  const stored = blobs.reduce((sum, b) => sum + b.size, 0);
  if (stored + LIMITS.fileBytes > LIMITS.storageBytes) return 'Link sharing is full';
  const recent = blobs.filter((b) => now - b.uploadedAt.getTime() < 30 * DAY).length;
  if (recent >= LIMITS.uploadsPer30Days) return 'Link sharing has reached its monthly limit';
  return null;
}

// ponytail: per-instance cache so bursts of token requests don't each cost a list() operation;
// a shared counter (e.g. Edge Config) would be exact if abuse ever gets past the firewall rule.
let checked: { at: number; problem: string | null } | undefined;

async function currentProblem(): Promise<string | null> {
  const now = Date.now();
  if (checked && now - checked.at < 60_000) return checked.problem;
  const blobs = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: 'm/', limit: 1000, cursor });
    blobs.push(...page.blobs);
    cursor = page.cursor;
  } while (cursor);
  checked = { at: now, problem: quotaProblem(blobs, now) };
  return checked.problem;
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as HandleUploadBody;
    return Response.json(await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        if (!PATHNAME.test(pathname)) throw new Error('Invalid map id');
        const problem = await currentProblem();
        if (problem) throw new Error(problem);
        return {
          allowedContentTypes: ['application/vnd.google-earth.kmz'],
          maximumSizeInBytes: LIMITS.fileBytes,
          addRandomSuffix: false,
          allowOverwrite: false, // ids are content hashes: an existing id already holds this map
        };
      },
    }));
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }
}
