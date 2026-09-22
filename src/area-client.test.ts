import { describe, expect, it } from 'vitest';
import { areaTileUrlTemplate } from './area-client';

describe('area vector tile URL', () => {
  it('resolves the development proxy path for MapLibre workers', () => {
    expect(areaTileUrlTemplate('http://localhost:5173', '/api/areas'))
      .toBe('http://localhost:5173/api/areas/tiles/{z}/{x}/{y}.mvt?v=2');
  });

  it('preserves the hosted catalog URL in production', () => {
    expect(areaTileUrlTemplate('http://localhost:5173', 'https://areas.example.com/api/areas'))
      .toBe('https://areas.example.com/api/areas/tiles/{z}/{x}/{y}.mvt?v=2');
  });
});
