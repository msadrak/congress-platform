import { createHash } from 'node:crypto';
import type { Page } from '@playwright/test';

/**
 * Shared fixtures for the scanner specs: the manifest as the server sends it (tickets keyed by
 * qr_hash = sha256("<event_id>:<normalized secret>"), never the raw secret) and readers for the
 * scanner's IndexedDB at whatever version the app created.
 */

export const EVENT_ID = '7d3c8f52-6a1e-4c5b-9f0a-2b4d6e8f0a1c';

/** The backend's manifest_qr_hash. */
export const hashCode = (code: string, eventId = EVENT_ID) =>
  createHash('sha256').update(`${eventId}:${code.trim().toLowerCase()}`).digest('hex');

export interface FixtureTicket {
  qr_secret: string;
  ticket_id: string;
  attendee_name: string;
  ticket_tier_id: string;
  ticket_tier_name: string;
  is_admitted: boolean;
  admission_count: number;
}

export interface FixtureManifest {
  checkin_point: { id: string; name: string; location: string | null; policy_type: string; allowed_tier_ids: string[]; max_capacity: number | null };
  tickets: FixtureTicket[];
}

/** A test manifest (written with raw codes for readability) as the server sends it: full, with a cursor. */
export function wireManifest(manifest: FixtureManifest, extra: { cursor?: string; eventId?: string } = {}) {
  const eventId = extra.eventId ?? EVENT_ID;
  return {
    checkin_point: { event_id: eventId, ...manifest.checkin_point },
    event_id: eventId,
    generated_at: new Date().toISOString(),
    cursor: extra.cursor ?? '2026-10-23T10:00:00+00:00',
    is_delta: false,
    removed_qr_hashes: [],
    tickets: manifest.tickets.map(({ qr_secret, ...rest }) => ({ ...rest, qr_hash: hashCode(qr_secret, eventId) })),
  };
}

export interface StoredScan {
  scan_id: string;
  qr_secret: string;
  qr_hash?: string;
  status: string;
  sync_state: string;
  synced: boolean;
  rejection_reason: string | null;
}

/** Every record in the scanner's queued_scans store (empty when the database does not exist yet). */
export const storedScans = (page: Page) => page.evaluate(() => new Promise<StoredScan[]>((resolve) => {
  const req = indexedDB.open('congress_scanner_db');
  req.onsuccess = () => {
    const db = req.result;
    if (!db.objectStoreNames.contains('queued_scans')) { db.close(); resolve([]); return; }
    const all = db.transaction('queued_scans', 'readonly').objectStore('queued_scans').getAll();
    all.onsuccess = () => { db.close(); resolve(all.result as StoredScan[]); };
    all.onerror = () => { db.close(); resolve([]); };
  };
  req.onerror = () => resolve([]);
}));

/** Whether the scanner still caches a manifest for this point. */
export const manifestExists = (page: Page, pointId: string) => page.evaluate((id) => new Promise<boolean>((resolve) => {
  const req = indexedDB.open('congress_scanner_db');
  req.onsuccess = () => {
    const db = req.result;
    if (!db.objectStoreNames.contains('manifests')) { db.close(); resolve(false); return; }
    const get = db.transaction('manifests', 'readonly').objectStore('manifests').get(id);
    get.onsuccess = () => { db.close(); resolve(Boolean(get.result)); };
    get.onerror = () => { db.close(); resolve(false); };
  };
  req.onerror = () => resolve(false);
}), pointId);

/** Writes one record into queued_scans, as a scanner (possibly an older one) would have. */
export const injectScan = (page: Page, pointId: string, scan: Record<string, unknown>) => page.evaluate(({ id, record }) => new Promise<void>((resolve, reject) => {
  const req = indexedDB.open('congress_scanner_db');
  req.onerror = () => reject(req.error);
  req.onsuccess = () => {
    const db = req.result;
    const tx = db.transaction('queued_scans', 'readwrite');
    tx.objectStore('queued_scans').put({ point_id: id, scanned_at: new Date().toISOString(), synced: false, ...record });
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  };
}), { id: pointId, record: scan });
