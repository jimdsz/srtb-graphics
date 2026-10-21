import type { MediaAsset } from '../src/studio/domain';

// Leave headroom below D1's 100 bound-parameter limit for each statement.
const chunkSize = 90;

export async function readyMedia(db: D1Database, references: readonly string[]): Promise<MediaAsset[]> {
  const ids = [...new Set(references)];
  const rows = new Map<string, MediaAsset>();
  for (let offset = 0; offset < ids.length; offset += chunkSize) {
    const chunk = ids.slice(offset, offset + chunkSize);
    const result = await db.prepare(`SELECT id,name,mime_type,bytes,status,created_by,created_at FROM media WHERE id IN (${chunk.map(() => '?').join(',')}) AND status='ready' AND tool_scope='graphics'`)
      .bind(...chunk).all<MediaAsset>();
    for (const row of result.results) rows.set(row.id, row);
  }
  // IN does not guarantee ordering; retain the existing reference order.
  return ids.flatMap(id => { const row = rows.get(id); return row ? [row] : []; });
}
