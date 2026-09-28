import type { RideTrackingPoint } from './ride-background-tracking';

export function gpxDocument(points: RideTrackingPoint[]) {
  const escapeXml = (value: string) => value.replace(/[<>&'\"]/g, character => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[character]!);
  const trackPoints = points
    .filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lng) && Number.isFinite(point.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp)
    .map(point => `      <trkpt lat="${point.lat}" lon="${point.lng}"><time>${new Date(point.timestamp).toISOString()}</time>${typeof point.speed === 'number' ? `<extensions><speed>${point.speed}</speed></extensions>` : ''}</trkpt>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Roam" xmlns="http://www.topografix.com/GPX/1/1">\n  <metadata><name>${escapeXml('Roam ride')}</name></metadata>\n  <trk><name>${escapeXml('Roam ride')}</name><trkseg>\n${trackPoints}\n  </trkseg></trk>\n</gpx>\n`;
}
