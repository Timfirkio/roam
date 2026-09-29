import { describe, expect, it } from 'vitest';
import { sessionSearchMatches } from './session-search';

describe('sessionSearchMatches', () => {
  it('ignores accents and punctuation in titles and regions', () => {
    expect(sessionSearchMatches('sodermalm', 'Södermalm · Evening', [])).toBe(true);
    expect(sessionSearchMatches('kungsholmen evening', 'Kungsholmen · Evening', [])).toBe(true);
    expect(sessionSearchMatches('norr-malm', 'Morning ride', ['Norrmalm'])).toBe(true);
  });

  it('allows small spelling errors without matching unrelated short words', () => {
    expect(sessionSearchMatches('sodermlam', 'Södermalm', [])).toBe(true);
    expect(sessionSearchMatches('evenig', 'Evening ride', [])).toBe(true);
    expect(sessionSearchMatches('cat', 'Car ride', [])).toBe(false);
    expect(sessionSearchMatches('south', 'North ride', [])).toBe(false);
  });
});
