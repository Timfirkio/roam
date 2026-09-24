import { describe, expect, it } from 'vitest';
import { displayAreaName } from './area-display-name';

describe('area display names', () => {
  it.each([
    ['Enskede-Årsta-Vantörs stadsdelsområde', 'Enskede-Årsta-Vantörs'],
    ['Södermalms stadsdelsområde', 'Södermalm'],
    ['Hägersten-Älvsjö stadsdelsområde', 'Hägersten-Älvsjö'],
    ['Norra innerstadens stadsdelsområde', 'Norra innerstaden'],
    ['Kungsholmens stadsdelsområde', 'Kungsholmen'],
  ])('shortens %s to %s at level 9', (name, expected) => {
    expect(displayAreaName(name, 9)).toBe(expected);
  });

  it('keeps municipality and county names intact', () => {
    expect(displayAreaName('Stockholms kommun', 7)).toBe('Stockholms kommun');
    expect(displayAreaName('Stockholms län', 4)).toBe('Stockholms län');
    expect(displayAreaName('Södermalms stadsdelsområde', 7)).toBe('Södermalms stadsdelsområde');
  });
});
