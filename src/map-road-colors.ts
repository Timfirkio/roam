/** Both path states share one dash pattern and width; color shows discovery. */
export const DISCOVERED_UNPAVED_ROAD_COLOR = '#2bb8b0';
export const UNDISCOVERED_UNPAVED_ROAD_COLOR = '#154644';
export const UNPAVED_ROAD_DASHARRAY = [2.5, 2] as const;
export const UNPAVED_ROAD_WIDTH = ['interpolate', ['linear'], ['zoom'], 6, 1, 10, 1.2, 14, 2.4, 18, 3] as const;
