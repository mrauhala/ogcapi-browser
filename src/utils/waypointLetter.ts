// A path's vertices by letter, A to Z, then AA, AB…: the same in the map's list as along the section's axis
export const waypointLetter = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : waypointLetter(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)));
