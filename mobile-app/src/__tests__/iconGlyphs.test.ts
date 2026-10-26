import { describe, it, expect } from '@jest/globals';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Blank-icon regression guard.
 *
 * An icon name that is not in the Ionicons glyphmap renders as an empty box
 * with only a console warning at runtime, so it is easy to ship unnoticed.
 * This scans every screen/component for quoted icon names and fails the build
 * list if any of them is not a real Ionicons glyph.
 */

const GLYPHMAP = join(
  __dirname,
  '..',
  '..',
  'node_modules',
  '@expo',
  'vector-icons',
  'build',
  'vendor',
  'react-native-vector-icons',
  'glyphmaps',
  'Ionicons.json'
);

const SRC = join(__dirname, '..', '..');
const SUFFIXES = /-(outline|sharp|filled)$/;

const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
};

describe('Ionicons glyph names', () => {
  const valid = new Set<string>(
    Object.keys(JSON.parse(readFileSync(GLYPHMAP, 'utf8')) as Record<string, unknown>)
  );

  it('only uses icon names that exist in the glyphmap', () => {
    const offenders: string[] = [];
    const pattern = /['"]([a-z0-9]+(?:-[a-z0-9]+)*)['"]/g;

    for (const file of walk(join(SRC, 'src'))) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(pattern)) {
        const name = match[1];
        if (!SUFFIXES.test(name)) continue;
        if (valid.has(name)) continue;
        offenders.push(`${name} -> ${file.slice(SRC.length + 1)}`);
      }
    }

    expect(offenders.sort()).toEqual([]);
  });
});
