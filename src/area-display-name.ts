const stockholmGenitives: Record<string, string> = {
  'Kungsholmens': 'Kungsholmen',
  'Norra innerstadens': 'Norra innerstaden',
  'Skarpnäcks': 'Skarpnäck',
  'Skärholmens': 'Skärholmen',
  'Södermalms': 'Södermalm',
};

export function shortRegionName(name: string) {
  const match = /^(.*?) stadsdelsområde$/i.exec(name);
  if (!match) return name;
  return stockholmGenitives[match[1]] ?? match[1];
}

export function displayAreaName(name: string, adminLevel: number) {
  return adminLevel === 9 ? shortRegionName(name) : name;
}
