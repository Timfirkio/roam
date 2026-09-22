import { describe, expect, it } from 'vitest';
import { PostgisAreaService } from './postgis-area-service.mjs';

function catalog(rowsByQuery) {
  const calls = [];
  return {
    calls,
    async query(sql, values) {
      calls.push({ sql, values });
      return { rows: rowsByQuery(sql, values) };
    },
  };
}

describe('PostGIS area catalog', () => {
  it('resolves containing administrative areas from the imported catalog', async () => {
    const pool = catalog(sql => sql.includes('from osm.boundaries') ? [{ id: 'relation/99', name: 'Årsta', admin_level: 10, country_code: 'SE', boundary_version: 'boundary-v1', source_version: 'sweden-2026-09-21' }] : []);
    const service = new PostgisAreaService('postgres://unused', { pool });
    const result = await service.lookup(18.05, 59.29);
    expect(result.source).toBe('Roam OSM catalog');
    expect(result.areas[0].area).toMatchObject({ id: 'relation/99', label: 'Stadsdel', geometry: null });
    expect(pool.calls[0].sql).toContain('ST_Covers');
    await service.close();
  });

  it('uses the database vector-tile function and rejects invalid tile coordinates', async () => {
    const pool = catalog(() => [{ tile: Buffer.from('tile') }]);
    const service = new PostgisAreaService('postgres://unused', { pool });
    await expect(service.boundaryTile(12, 2199, 1240)).resolves.toEqual(Buffer.from('tile'));
    await expect(service.boundaryTile(2, 4, 1)).rejects.toThrow('Invalid map tile');
    expect(pool.calls[0].sql).toContain('osm.boundary_tile');
    await service.close();
  });

  it('finds catalog names when the search omits Swedish diacritics', async () => {
    const pool = catalog(() => [{ id: 'relation/99', name: 'Södermalm', admin_level: 10, lng: '18.06', lat: '59.32' }]);
    const service = new PostgisAreaService('postgres://unused', { pool });
    await expect(service.search('Sodermalm')).resolves.toEqual([{ id: 'relation/99', name: 'Södermalm', lng: 18.06, lat: 59.32, type: 'Administrative level 10' }]);
    expect(pool.calls[0].values).toEqual(['%sodermalm%']);
    await service.close();
  });
});
