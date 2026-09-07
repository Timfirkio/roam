// Live regression: node scripts/verify-cycleway.mjs (Node 22.18+).
// OpenFreeMap merges OSM ways, so match a node location and tags, not tile IDs.
import assert from 'node:assert/strict';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { createNetworkTileLoader } from '../src/network-tiles.ts';

const lng = 18.0426307, lat = 59.3044625; // west node of OSM way 434713008
const metadata = await (await fetch('https://tiles.openfreemap.org/planet')).json();
const load = createNetworkTileLoader(metadata.tiles[0]);
function hasExample(data, z, x, y) {
  const layer = new VectorTile(new PbfReader(data)).layers.transportation;
  for (let i = 0; i < (layer?.length ?? 0); i++) {
    const f = layer.feature(i);
    if (f.properties.subclass !== 'cycleway' || f.properties.bicycle !== 'designated') continue;
    const geometry = f.toGeoJSON(x, y, z).geometry;
    const lines = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates;
    if (lines.some(line => line.some(([lon, latitude]) => Math.hypot((lon - lng) * 56800, (latitude - lat) * 111200) < 2))) return true;
  }
  return false;
}
for (const z of [12, 13, 14]) {
  const n = 2 ** z;
  const x = Math.floor((lng + 180) / 360 * n);
  const y = Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * n);
  const url = metadata.tiles[0].replace('{z}', z).replace('{x}', x).replace('{y}', y);
  const original = await (await fetch(url)).arrayBuffer();
  const corrected = await load(z, x, y, new AbortController().signal);
  const present = hasExample(corrected, z, x, y);
  console.log(`z${z}: provider=${hasExample(original, z, x, y)}, Roam detail=${present}`);
  assert(present, `Example cycleway missing at z${z}`);
}
