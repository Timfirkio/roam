export function displayNameSortKey(name: string) {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('en-US');
}

export function compareDisplayNames(a: { name: string }, b: { name: string }) {
  return displayNameSortKey(a.name).localeCompare(displayNameSortKey(b.name), 'en-US');
}
