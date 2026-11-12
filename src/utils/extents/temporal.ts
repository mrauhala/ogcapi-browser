import type { Temporal } from '../../types/api';

// Utility function to normalize temporal extent to a standard format
export function normalizeTemporal(temporal: Temporal | null | undefined): {
  intervals: [string | null, string | null][];
  values: string[];
  trs: string;
} | null {
  // Handle missing temporal
  if (!temporal) {
    console.log('No temporal extent provided');
    return null;
  }

  try {
    const result = {
      intervals: [] as [string | null, string | null][],
      values: [] as string[],
      trs: temporal.trs || 'Gregorian'
    };

    // Process intervals if they exist
    if (temporal.interval && Array.isArray(temporal.interval)) {
      for (const interval of temporal.interval) {
        if (Array.isArray(interval) && interval.length >= 2) {
          const [start, end] = interval;
          result.intervals.push([start, end]);
        } else if (typeof interval === 'string') {
          // Some APIs incorrectly put individual datetime values in the interval array
          // Treat these as values instead
          result.values.push(interval);
        } else {
          console.warn('Invalid temporal interval format:', interval);
        }
      }
    }

    // Process values if they exist
    if (temporal.values && Array.isArray(temporal.values)) {
      result.values = temporal.values.filter(value => typeof value === 'string');
    }

    return result;
  } catch (error) {
    console.error('Error normalizing temporal extent:', error, 'Input:', temporal);
    return null;
  }
}

// Utility function to format temporal intervals for display
export function formatTemporalInterval(start: string | null, end: string | null): string {
  const formatDate = (dateStr: string | null) => {
    if (!dateStr || dateStr === '..') return 'open';
    try {
      const date = new Date(dateStr);
      // Format: "Nov 1, 2025 06:00" or just date if time is 00:00
      const timeStr = date.toISOString().split('T')[1];
      const hasTime = timeStr && !timeStr.startsWith('00:00:00');

      if (hasTime) {
        const formatted = date.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          timeZone: 'UTC'
        });
        const time = date.toISOString().split('T')[1].substring(0, 5);
        return `${formatted} ${time}`;
      } else {
        return date.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          timeZone: 'UTC'
        });
      }
    } catch {
      return dateStr;
    }
  };

  const formattedStart = formatDate(start);
  const formattedEnd = formatDate(end);

  return `${formattedStart} – ${formattedEnd}`;
}

// Utility function to format ISO 8601 date strings for human-readable display
export function formatDateString(dateString: string | null): string {
  if (!dateString || dateString === '..') return 'open';

  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) {
      return dateString; // Return original if parsing fails
    }

    // Format: "Nov 1, 2025 06:00" or just date if time is 00:00 in UTC
    const timeStr = date.toISOString().split('T')[1];
    const hasTime = timeStr && !timeStr.startsWith('00:00:00');

    if (hasTime) {
      const formatted = date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC'
      });
      const time = date.toISOString().split('T')[1].substring(0, 5);
      return `${formatted} ${time}`;
    } else {
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC'
      });
    }
  } catch (error) {
    console.warn('Error formatting date string:', dateString, error);
    return dateString;
  }
}

// Utility function to get the overall temporal extent that encompasses all intervals
export function getOverallTemporalExtent(intervals: [string | null, string | null][]): [string | null, string | null] | null {
  if (!intervals || intervals.length === 0) {
    return null;
  }

  let overallStart: string | null = null;
  let overallEnd: string | null = null;

  for (const [start, end] of intervals) {
    // Handle start times
    if (start !== null) {
      if (overallStart === null || start < overallStart) {
        overallStart = start;
      }
    } else {
      overallStart = null; // If any interval is open at the start, overall is open
    }

    // Handle end times
    if (end !== null) {
      if (overallEnd === null || end > overallEnd) {
        overallEnd = end;
      }
    } else {
      overallEnd = null; // If any interval is open at the end, overall is open
    }
  }

  return [overallStart, overallEnd];
}

// Helper function to parse ISO 8601 duration strings (e.g., PT1M, PT1H, P1D)
export function parseDuration(durationStr: string): number | null {
  try {
    // ISO 8601 duration format: P[n]Y[n]M[n]DT[n]H[n]M[n]S
    // Examples: PT1M (1 minute), PT1H (1 hour), P1D (1 day), PT30S (30 seconds)

    const match = durationStr.match(/^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/);

    if (!match) {
      return null;
    }

    const [, years, months, days, hours, minutes, seconds] = match;

    let milliseconds = 0;

    // Note: Year and month durations are approximate since they vary
    if (years) milliseconds += parseInt(years, 10) * 365 * 24 * 60 * 60 * 1000;
    if (months) milliseconds += parseInt(months, 10) * 30 * 24 * 60 * 60 * 1000;
    if (days) milliseconds += parseInt(days, 10) * 24 * 60 * 60 * 1000;
    if (hours) milliseconds += parseInt(hours, 10) * 60 * 60 * 1000;
    if (minutes) milliseconds += parseInt(minutes, 10) * 60 * 1000;
    if (seconds) milliseconds += parseFloat(seconds) * 1000;

    return milliseconds;
  } catch (error) {
    console.warn('Error parsing duration:', durationStr, error);
    return null;
  }
}

// Utility function to compute an appropriate step size in ms based on temporal span
export function computeStepMs(spanMs: number): number {
  if (spanMs <= 24 * 60 * 60 * 1000) return 60 * 60 * 1000;           // <1d: hourly
  if (spanMs <= 7 * 24 * 60 * 60 * 1000) return 3 * 60 * 60 * 1000;   // <1w: 3h
  if (spanMs <= 31 * 24 * 60 * 60 * 1000) return 6 * 60 * 60 * 1000;  // <1m: 6h
  if (spanMs <= 365 * 24 * 60 * 60 * 1000) return 24 * 60 * 60 * 1000; // <1y: daily
  return 7 * 24 * 60 * 60 * 1000;                                       // >1y: weekly
}

// An instant as Maps 1.0 asks servers to take it, in UTC with Z: /req/datetime/datetime-definition C, "the server is only
// required to support the Z UTC time notation, and not required to support local time offsets". As it was where it
// doesn't read as a time
function inUtc(time: string): string {
  const epoch = Date.parse(time);
  return isNaN(epoch) ? time : new Date(epoch).toISOString().replace(/\.000Z$/, 'Z');
}

// The times a temporal extent lists, as EDR's values have them: its values, else its grid's coordinates, else its regular
// grid as a repeating interval, R{cellsCount}/{firstCoordinate}/{resolution}, which expandTemporalValues reads. A grid's
// times are written in UTC with Z. Empty where it lists none, as for an interval alone
export function temporalValuesOf(temporal: Temporal | null | undefined): string[] {
  if (!temporal) return [];
  if (Array.isArray(temporal.values) && temporal.values.length > 0) return temporal.values;
  const grid = temporal.grid;
  if (!grid || typeof grid !== 'object') return [];
  if (Array.isArray(grid.coordinates)) {
    return grid.coordinates.filter((time): time is string => typeof time === 'string' && !!time.trim()).map(inUtc);
  }
  const { firstCoordinate: first, resolution, cellsCount } = grid;
  if (typeof first === 'string' && typeof resolution === 'string' && typeof cellsCount === 'number' && cellsCount > 0 && parseDuration(resolution)) {
    return [`R${Math.floor(cellsCount)}/${inUtc(first)}/${resolution}`];
  }
  return [];
}

// Where a temporal extent's listed times come from, for saying so: EDR's values, a grid's coordinates, or a regular grid
export type ListedTimesForm = 'values' | 'coordinates' | 'regular' | null;
export function listedTimesForm(temporal: Temporal | null | undefined): ListedTimesForm {
  if (!temporal) return null;
  if (Array.isArray(temporal.values) && temporal.values.length > 0) return 'values';
  const values = temporalValuesOf(temporal);
  if (!values.length) return null;
  return Array.isArray(temporal.grid?.coordinates) ? 'coordinates' : 'regular';
}

// The step between a grid's times where they're evenly spaced: a regular grid's resolution, or the one gap between each
// of its coordinates. Null for EDR's values, which say nothing of a step, and for a grid that isn't even
export function gridStepMs(temporal: Temporal | null | undefined): number | null {
  const form = listedTimesForm(temporal);
  if (form === 'regular') return parseDuration(String(temporal!.grid!.resolution));
  if (form !== 'coordinates') return null;
  const times = temporalValuesOf(temporal).map(time => Date.parse(time));
  if (times.length < 3 || times.some(isNaN)) return null;
  const step = times[1] - times[0];
  return step > 0 && times.every((time, i) => i === 0 || time - times[i - 1] === step) ? step : null;
}

// Utility function to expand temporal extent into individual datetime values for selection
// Prioritizes the times listed (temporal.values, else a grid's) if available, falls back to temporal.interval
export function expandTemporalValues(temporal: Temporal | null | undefined, maxValues: number = 1000): string[] {
  const values: string[] = [];
  const seen = new Set<string>();

  if (!temporal) {
    return values;
  }

  const addValue = (v: string) => {
    if (!seen.has(v)) {
      seen.add(v);
      values.push(v);
    }
  };

  // Helper function to expand an interval string (e.g., "2024-01-01T00:00Z/2024-01-02T00:00Z")
  const expandIntervalString = (intervalStr: string): string[] => {
    const expanded: string[] = [];

    // Check for ISO 8601 repeating interval format: R{n}/{start}/{duration}
    // Example: "R1440/2025-11-02T15:26:00Z/PT1M" means 1440 repetitions, starting at 2025-11-02T15:26:00Z, every 1 minute
    const repeatingMatch = intervalStr.match(/^R(\d+)\/([^/]+)\/(.+)$/);
    if (repeatingMatch) {
      const [, repetitionsStr, startStr, durationStr] = repeatingMatch;
      const repetitions = parseInt(repetitionsStr, 10);

      try {
        const startDate = new Date(startStr);
        if (isNaN(startDate.getTime())) {
          console.warn('Invalid start date in repeating interval:', startStr);
          return [];
        }

        // Parse ISO 8601 duration (PT1M, PT1H, P1D, etc.)
        const durationMs = parseDuration(durationStr);
        if (durationMs === null) {
          console.warn('Invalid duration in repeating interval:', durationStr);
          return [];
        }

        // Generate the repeated values
        let currentTime = startDate.getTime();
        for (let i = 0; i < Math.min(repetitions, maxValues); i++) {
          const isoString = new Date(currentTime).toISOString().replace(/\.\d{3}Z$/, 'Z');
          expanded.push(isoString);
          currentTime += durationMs;
        }

        return expanded;
      } catch (error) {
        console.warn('Error processing repeating interval:', intervalStr, error);
        return [];
      }
    }

    // Check if it's a simple interval format (contains "/")
    if (!intervalStr.includes('/')) {
      // Single datetime value
      return [intervalStr];
    }

    const parts = intervalStr.split('/');
    if (parts.length !== 2) {
      console.warn('Invalid interval format:', intervalStr);
      return [];
    }

    const [start, end] = parts;

    try {
      const startDate = new Date(start);
      const endDate = new Date(end);

      // Skip invalid dates
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        console.warn('Invalid dates in interval:', intervalStr);
        return [];
      }

      // Calculate time difference
      const timeDiff = endDate.getTime() - startDate.getTime();

      // Determine appropriate step size based on interval length
      let stepMs: number;

      if (timeDiff <= 24 * 60 * 60 * 1000) {
        // Less than 1 day: use hourly steps
        stepMs = 60 * 60 * 1000;
      } else if (timeDiff <= 7 * 24 * 60 * 60 * 1000) {
        // Less than 1 week: use 3-hour steps
        stepMs = 3 * 60 * 60 * 1000;
      } else if (timeDiff <= 31 * 24 * 60 * 60 * 1000) {
        // Less than 1 month: use 6-hour steps
        stepMs = 6 * 60 * 60 * 1000;
      } else if (timeDiff <= 365 * 24 * 60 * 60 * 1000) {
        // Less than 1 year: use daily steps
        stepMs = 24 * 60 * 60 * 1000;
      } else {
        // More than 1 year: use weekly steps
        stepMs = 7 * 24 * 60 * 60 * 1000;
      }

      // Generate time values
      let currentTime = startDate.getTime();
      let count = 0;

      while (currentTime <= endDate.getTime() && count < maxValues) {
        const isoString = new Date(currentTime).toISOString().replace(/\.\d{3}Z$/, 'Z');
        expanded.push(isoString);
        currentTime += stepMs;
        count++;
      }

      // Always include the end time if we haven't reached the limit
      if (count < maxValues) {
        const endIsoString = endDate.toISOString().replace(/\.\d{3}Z$/, 'Z');
        if (!expanded.includes(endIsoString)) {
          expanded.push(endIsoString);
        }
      }
    } catch (error) {
      console.warn('Error processing interval string:', intervalStr, error);
    }

    return expanded;
  };

  try {
    // PRIORITIZE the times listed if there are any
    const listed = temporalValuesOf(temporal);
    if (listed.length > 0) {
      listed.forEach(value => {
        if (value && typeof value === 'string') {
          // Check if value is an interval format (e.g., "2024-01-01T00:00Z/2024-01-02T00:00Z")
          if (value.includes('/')) {
            const expandedValues = expandIntervalString(value);
            expandedValues.forEach(v => addValue(v));
          } else {
            // Single datetime value
            addValue(value);
          }
        }
      });
    }
    // FALLBACK to temporal.interval ONLY if no times are listed
    else if (temporal.interval && Array.isArray(temporal.interval)) {
      for (const interval of temporal.interval) {
        if (!Array.isArray(interval) || interval.length < 2) {
          continue;
        }

        const [start, end] = interval;

        // Skip open-ended intervals (we can't expand them)
        if (start === null || end === null) {
          continue;
        }

        try {
          const startDate = new Date(start);
          const endDate = new Date(end);

          // Skip invalid dates
          if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
            continue;
          }

          // Calculate time difference
          const timeDiff = endDate.getTime() - startDate.getTime();

          // Determine appropriate step size based on interval length
          let stepMs: number;

          if (timeDiff <= 24 * 60 * 60 * 1000) {
            // Less than 1 day: use hourly steps
            stepMs = 60 * 60 * 1000;
          } else if (timeDiff <= 7 * 24 * 60 * 60 * 1000) {
            // Less than 1 week: use 3-hour steps
            stepMs = 3 * 60 * 60 * 1000;
          } else if (timeDiff <= 31 * 24 * 60 * 60 * 1000) {
            // Less than 1 month: use 6-hour steps
            stepMs = 6 * 60 * 60 * 1000;
          } else if (timeDiff <= 365 * 24 * 60 * 60 * 1000) {
            // Less than 1 year: use daily steps
            stepMs = 24 * 60 * 60 * 1000;
          } else {
            // More than 1 year: use weekly steps
            stepMs = 7 * 24 * 60 * 60 * 1000;
          }

          // Generate time values
          let currentTime = startDate.getTime();
          let count = 0;

          while (currentTime <= endDate.getTime() && count < maxValues) {
            const isoString = new Date(currentTime).toISOString().replace(/\.\d{3}Z$/, 'Z');
            addValue(isoString);
            currentTime += stepMs;
            count++;
          }

          // Always include the end time if we haven't reached the limit
          if (count < maxValues) {
            const endIsoString = endDate.toISOString().replace(/\.\d{3}Z$/, 'Z');
            addValue(endIsoString);
          }
        } catch (error) {
          console.warn('Error processing temporal interval:', interval, error);
        }
      }
    }

    // Sort values chronologically and remove duplicates
    const uniqueValues = Array.from(new Set(values)).sort();

    // Limit to maxValues
    return uniqueValues.slice(0, maxValues);
  } catch (error) {
    console.error('Error expanding temporal values:', error);
    return [];
  }
}
