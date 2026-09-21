import { DatabaseSync } from 'node:sqlite';

/** One service process owns this queue. Each tile checkpoint commits atomically. */
export class AreaStore {
  constructor(path) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS areas (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS lookups (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tiles (key TEXT PRIMARY KEY, value TEXT NOT NULL, accessed INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS checkpoints (job TEXT NOT NULL, tile TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(job,tile));
    `);
  }
  area(id) { return this.read('areas', id); }
  saveArea(area) { this.write('areas', area.id, area); }
  job(id) { return this.read('jobs', id); }
  saveJob(job) { this.write('jobs', job.id, { ...job, updatedAt: new Date().toISOString() }); }
  jobs() { return this.db.prepare('SELECT value FROM jobs ORDER BY rowid').all().map(row => JSON.parse(row.value)); }
  read(table, id) {
    const row = this.db.prepare(`SELECT value FROM ${table} WHERE id = ?`).get(id);
    return row ? JSON.parse(row.value) : null;
  }
  write(table, id, value) { this.db.prepare(`INSERT OR REPLACE INTO ${table} (id,value) VALUES (?,?)`).run(id, JSON.stringify(value)); }
  lookup(key) {
    const row = this.db.prepare('SELECT value FROM lookups WHERE key=? AND expires>?').get(key, Date.now());
    return row ? JSON.parse(row.value) : null;
  }
  saveLookup(key, ids) {
    this.db.prepare('DELETE FROM lookups WHERE expires < ?').run(Date.now());
    this.db.prepare('INSERT OR REPLACE INTO lookups VALUES (?,?,?)').run(key, JSON.stringify(ids), Date.now() + 86_400_000);
  }
  tile(key) {
    const row = this.db.prepare('SELECT value FROM tiles WHERE key=?').get(key);
    if (!row) return null;
    this.db.prepare('UPDATE tiles SET accessed=? WHERE key=?').run(Date.now(), key);
    return JSON.parse(row.value);
  }
  saveTile(key, roads) {
    this.db.prepare('INSERT OR REPLACE INTO tiles VALUES (?,?,?)').run(key, JSON.stringify(roads), Date.now());
    this.db.exec('DELETE FROM tiles WHERE key IN (SELECT key FROM tiles ORDER BY accessed DESC LIMIT -1 OFFSET 4096)');
  }
  checkpoint(job, tile) {
    const row = this.db.prepare('SELECT value FROM checkpoints WHERE job=? AND tile=?').get(job, tile);
    return row ? JSON.parse(row.value) : null;
  }
  saveCheckpoint(job, tile, totals) { this.db.prepare('INSERT OR REPLACE INTO checkpoints VALUES (?,?,?)').run(job, tile, JSON.stringify(totals)); }
  close() { this.db.close(); }
}
