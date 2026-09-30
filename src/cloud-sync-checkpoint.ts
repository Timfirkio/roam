export type CloudSyncCheckpoint = {
  version: 1;
  discoveryCursor: string;
  rideCursor: string;
  discoveryIds: string[];
  rideSignatures: Record<string, string>;
};

const key = (userId: string) => `roam.cloud-sync.v1.${userId}`;

export function loadCloudSyncCheckpoint(userId: string): CloudSyncCheckpoint | null {
  try {
    const value = localStorage.getItem(key(userId));
    if (!value) return null;
    const parsed = JSON.parse(value) as CloudSyncCheckpoint;
    if (parsed.version !== 1 || !Array.isArray(parsed.discoveryIds) || !parsed.rideSignatures
      || typeof parsed.discoveryCursor !== 'string' || typeof parsed.rideCursor !== 'string') return null;
    return parsed;
  } catch { return null; }
}

export function saveCloudSyncCheckpoint(userId: string, checkpoint: CloudSyncCheckpoint) {
  // The device cache is still correct if browser storage is unavailable. The
  // next pass simply starts with a full reconciliation again.
  try { localStorage.setItem(key(userId), JSON.stringify(checkpoint)); } catch { /* no persistent checkpoint */ }
}
