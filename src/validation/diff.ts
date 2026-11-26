import { type Marker, type MarkerLevel } from './markers.js';

export type DocumentKind = 'published' | 'drafts' | 'versions';

export interface MarkerDiff {
  readonly introduced: Marker[];
  readonly resolved: Marker[];
}

/** One row of the report: the same problem on many documents. */
export interface MarkerGroup {
  readonly documentType: string;
  readonly pathPattern: string;
  readonly code: string;
  readonly message: string;
  /** Highest level among the group's markers. */
  readonly level: MarkerLevel;
  readonly published: number;
  readonly drafts: number;
  readonly versions: number;
  /** Up to five document IDs, lowest first. */
  readonly sample: readonly string[];
}

const SAMPLE_SIZE = 5;
const LEVEL_RANK: Record<MarkerLevel, number> = { info: 0, warning: 1, error: 2 };

/** Drafts and versions are told apart by ID prefix, the same rule the impact queries use. */
export function documentKind(documentId: string): DocumentKind {
  if (documentId.startsWith('drafts.')) return 'drafts';
  if (documentId.startsWith('versions.')) return 'versions';
  return 'published';
}

function compareText(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function compareMarkers(a: Marker, b: Marker): number {
  return (
    compareText(a.documentId, b.documentId) ||
    compareText(a.path, b.path) ||
    compareText(a.code, b.code) ||
    compareText(a.message, b.message)
  );
}

/** Identity of a marker for diffing. The level is left out, so a severity change isn't a new problem. */
function markerKey(marker: Marker): string {
  return JSON.stringify([marker.documentId, marker.path, marker.code, marker.message]);
}

function unique(markers: readonly Marker[]): Map<string, Marker> {
  const byKey = new Map<string, Marker>();
  for (const marker of markers) {
    const key = markerKey(marker);
    if (!byKey.has(key)) byKey.set(key, marker);
  }
  return byKey;
}

/** Markers only in head are introduced, and markers only in base are resolved. Both lists are sorted. */
export function diffMarkers(base: readonly Marker[], head: readonly Marker[]): MarkerDiff {
  const before = unique(base);
  const after = unique(head);
  const introduced = [...after].filter(([key]) => !before.has(key)).map(([, m]) => m);
  const resolved = [...before].filter(([key]) => !after.has(key)).map(([, m]) => m);
  return {
    introduced: introduced.sort(compareMarkers),
    resolved: resolved.sort(compareMarkers),
  };
}

interface GroupAccumulator {
  readonly documentType: string;
  readonly pathPattern: string;
  readonly code: string;
  readonly message: string;
  level: MarkerLevel;
  readonly ids: Set<string>;
}

/**
 * Groups markers by type, path pattern, code and message. Each document counts once per group,
 * split into published, drafts and versions. The sample is the five lowest IDs.
 */
export function groupMarkers(markers: readonly Marker[]): MarkerGroup[] {
  const groups = new Map<string, GroupAccumulator>();
  for (const marker of markers) {
    const key = JSON.stringify([
      marker.documentType,
      marker.pathPattern,
      marker.code,
      marker.message,
    ]);
    let group = groups.get(key);
    if (group === undefined) {
      group = {
        documentType: marker.documentType,
        pathPattern: marker.pathPattern,
        code: marker.code,
        message: marker.message,
        level: marker.level,
        ids: new Set(),
      };
      groups.set(key, group);
    }
    if (LEVEL_RANK[marker.level] > LEVEL_RANK[group.level]) group.level = marker.level;
    group.ids.add(marker.documentId);
  }

  return [...groups.values()]
    .sort(
      (a, b) =>
        compareText(a.documentType, b.documentType) ||
        compareText(a.pathPattern, b.pathPattern) ||
        compareText(a.code, b.code) ||
        compareText(a.message, b.message),
    )
    .map((group) => {
      const ids = [...group.ids].sort(compareText);
      const kinds = ids.map(documentKind);
      return {
        documentType: group.documentType,
        pathPattern: group.pathPattern,
        code: group.code,
        message: group.message,
        level: group.level,
        published: kinds.filter((k) => k === 'published').length,
        drafts: kinds.filter((k) => k === 'drafts').length,
        versions: kinds.filter((k) => k === 'versions').length,
        sample: ids.slice(0, SAMPLE_SIZE),
      };
    });
}
