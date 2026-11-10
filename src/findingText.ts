import type { ValidationError } from './types/api';

// How a finding reads in Checks and in Raw's bar: its path, shown apart, and its message

// A finding's path as shown. One found in every item of an array, as a locations list's grouped findings are, has its
// message start with the path they share, an item's index as * (/features/*/properties), and the first item's as its
// path, for its line in Raw: the shared one is what's true of it
export function findingPath({ path, message }: ValidationError): string | undefined {
  if (!path) return path;
  const shared = message.slice(0, Math.max(message.indexOf(':'), 0)).split('/');
  const own = path.split('/');
  const isIndex = (segment: string) => segment !== '' && [...segment].every(digit => digit >= '0' && digit <= '9');
  const matches = shared.length === own.length && shared.every((segment, index) => segment === own[index] || (segment === '*' && isIndex(own[index])));
  return matches ? shared.join('/') : path;
}

// A finding's message starts with its path, which is shown apart. One at the root has only the colon
export function findingMessage(finding: ValidationError): string {
  const path = findingPath(finding);
  const rest = path && finding.message.startsWith(path) ? finding.message.slice(path.length) : finding.message;
  return rest.replace(/^:\s*/, '');
}
