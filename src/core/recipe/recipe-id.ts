// §5.2 — recipeId is a content hash: identical recipes collapse; it keys the asset
// cache and the preview-clip binding. Canonical JSON (sorted keys, undefined dropped)
// so property order can never change identity.

import type { Recipe } from './schema';

const canonicalize = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`);
  return `{${entries.join(',')}}`;
};

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const U64_MASK = 0xffffffffffffffffn;

// ponytail: FNV-1a/64 over canonical JSON — fine as a cache/collapse key at prototype
// scale. Swap for SHA-256 before recipeIds become public content addresses.
export const computeRecipeId = (recipe: Recipe): string => {
  const text = canonicalize(recipe);
  let hash = FNV_OFFSET;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash ^ BigInt(text.charCodeAt(i))) * FNV_PRIME) & U64_MASK;
  }
  return `r${hash.toString(16).padStart(16, '0')}`;
};
