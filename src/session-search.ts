export function normalizeSessionSearch(value: string) {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('sv-SE')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

function withinEditDistance(a: string, b: string, limit: number) {
  if (Math.abs(a.length - b.length) > limit) return false;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row++) {
    const current = [row];
    for (let column = 1; column <= b.length; column++) {
      current[column] = Math.min(
        current[column - 1]! + 1,
        previous[column]! + 1,
        previous[column - 1]! + (a[row - 1] === b[column - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length]! <= limit;
}

export function sessionSearchMatches(query: string, title: string, districtNames: string[]) {
  const normalizedQuery = normalizeSessionSearch(query);
  if (!normalizedQuery) return true;
  const searchable = normalizeSessionSearch(`${title} ${districtNames.join(' ')}`);
  if (searchable.includes(normalizedQuery) || searchable.replaceAll(' ', '').includes(normalizedQuery.replaceAll(' ', ''))) return true;
  const words = searchable.split(' ');
  return normalizedQuery.split(' ').every(term => words.some(word => {
    if (word.includes(term)) return true;
    const allowedEdits = term.length >= 8 ? 2 : term.length >= 4 ? 1 : 0;
    return allowedEdits > 0 && withinEditDistance(term, word, allowedEdits);
  }));
}
