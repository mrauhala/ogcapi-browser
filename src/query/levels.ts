// z's levels, as EDR 1.1 has them (/req/edr/z-response): a level, a list of them, a range, or a repeating interval. The
// form's level dropdown chooses one or several from the collection's, and these say what it shows and what it sends

// A repeating interval: R, the number of intervals, the lowest level and the step, as R3/500/100
export const REPEATING_LEVELS = /^R(\d+)\/([^/]*)\/([^/]*)$/;

// Whether a z value is, or is being typed as, a repeating interval, which the dropdown can't show
export const startsRepeating = (value: string) => /^R\d/.test(value.trim());

// The same level, however it's written: 1000.0 is the collection's 1000
const sameLevel = (a: string, b: string) => a === b || (a !== '' && b !== '' && Number(a) === Number(b));

// The levels a z value names, each as the collection writes it if it's one of its own, and those that aren't
export function levelChoice(value: string, listed: string[]): { chosen: string[]; unlisted: string[] } {
  const named = value.split(',').map(level => level.trim()).filter(Boolean);
  const chosen = named.map(level => listed.find(each => sameLevel(level, each)) ?? level);
  return { chosen, unlisted: chosen.filter(level => !listed.includes(level)) };
}

// What the dropdown sends for the levels picked: any not the collection's as they were, then the rest in the
// collection's order, whatever order they were picked in
export const pickedLevels = (picked: string[], listed: string[]) =>
  [...picked.filter(level => !listed.includes(level)), ...listed.filter(level => picked.includes(level))].join(',');

// Why a level the dropdown shows isn't one of the collection's
export const unlistedReason = (level: string) => (Number.isFinite(Number(level)) ? "Not one of the collection's levels" : 'Not a number');
