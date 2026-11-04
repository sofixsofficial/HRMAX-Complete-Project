/**
 * ID-system unit tests (offline — pure helpers only, no AWS calls).
 *
 * Covers the formats and derivation rules of the backend-owned ID system:
 *   Company ID   COMP-[SHORT]-[YEAR]-[SERIAL]   e.g. COMP-SOF-2026-0001
 *   Employee ID  [SHORT]-EMP-[YEAR]-[SERIAL]    e.g. SOF-EMP-2026-0001
 *   Department   DEPT-[SERIAL]                  e.g. DEPT-0004
 *
 * Usage: npm test --prefix backend/aws   (requires: npm run build)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  lettersOf,
  deriveShortCode,
  nextShortCodeCandidate,
  formatCompanyCode,
  formatEmployeeCode,
  formatDepartmentCode,
  parseIssuedCode,
  yearOf,
} from '../dist/lib/ids.js';

// ---------------------------------------------------------------------------
// Short-code derivation from the company name
// ---------------------------------------------------------------------------

test('deriveShortCode takes the first 3 letters, uppercased', () => {
  assert.equal(deriveShortCode('Sofixs Pvt. Ltd.'), 'SOF');
  assert.equal(deriveShortCode('ABC Technologies'), 'ABC');
  assert.equal(deriveShortCode('XYZ'), 'XYZ');
  assert.equal(deriveShortCode('sofixs'), 'SOF');
  assert.equal(deriveShortCode('  a b c  '), 'ABC');
});

test('deriveShortCode falls back to CMP when the name has no letters', () => {
  assert.equal(deriveShortCode(''), 'CMP');
  assert.equal(deriveShortCode('123 !!'), 'CMP');
  assert.equal(deriveShortCode(undefined), 'CMP');
});

test('lettersOf strips everything but A–Z', () => {
  assert.equal(lettersOf('Sofixs Pvt. Ltd.'), 'SOFIXSPVTLTD');
  assert.equal(lettersOf('₹100 & Co.'), 'CO');
});

// ---------------------------------------------------------------------------
// Collision-free candidate derivation (deterministic for a taken set)
// ---------------------------------------------------------------------------

test('nextShortCodeCandidate extends the prefix when the base is taken', () => {
  const name = 'Sofixs Pvt. Ltd.'; // letters: SOFIXSPVTLTD
  assert.equal(nextShortCodeCandidate(name, new Set()), 'SOF');
  assert.equal(nextShortCodeCandidate(name, new Set(['SOF'])), 'SOFI');
  assert.equal(nextShortCodeCandidate(name, new Set(['SOF', 'SOFI'])), 'SOFIX');
  assert.equal(nextShortCodeCandidate(name, new Set(['SOF', 'SOFI', 'SOFIX'])), 'SOFIXS');
});

test('nextShortCodeCandidate appends a digit once the letters run out', () => {
  assert.equal(nextShortCodeCandidate('Sof', new Set(['SOF'])), 'SOF2');
  assert.equal(nextShortCodeCandidate('Sof', new Set(['SOF', 'SOF2'])), 'SOF3');
  // Name shorter than 3 letters still yields a usable code.
  assert.equal(nextShortCodeCandidate('XY', new Set(['XY'])), 'XY2');
});

// ---------------------------------------------------------------------------
// Formats
// ---------------------------------------------------------------------------

test('formatCompanyCode → COMP-[SHORT]-[YEAR]-[SERIAL]', () => {
  assert.equal(formatCompanyCode('SOF', 2026, 1), 'COMP-SOF-2026-0001');
  assert.equal(formatCompanyCode('ABC', 2026, 2), 'COMP-ABC-2026-0002');
  assert.equal(formatCompanyCode('XYZ', 2026, 3), 'COMP-XYZ-2026-0003');
});

test('formatEmployeeCode → [SHORT]-EMP-[YEAR]-[SERIAL]', () => {
  assert.equal(formatEmployeeCode('SOF', 2026, 1), 'SOF-EMP-2026-0001');
  assert.equal(formatEmployeeCode('SOF', 2026, 2), 'SOF-EMP-2026-0002');
  assert.equal(formatEmployeeCode('ABC', 2026, 1), 'ABC-EMP-2026-0001');
});

test('formatDepartmentCode pads to four digits', () => {
  assert.equal(formatDepartmentCode(4), 'DEPT-0004');
  assert.equal(formatDepartmentCode(1234), 'DEPT-1234');
});

// ---------------------------------------------------------------------------
// Parsing (used to seed counters from already-issued IDs)
// ---------------------------------------------------------------------------

test('parseIssuedCode reads year + serial from new-format IDs', () => {
  assert.deepEqual(parseIssuedCode('COMP-SOF-2026-0001'), { year: 2026, serial: 1 });
  assert.deepEqual(parseIssuedCode('SOF-EMP-2026-0042'), { year: 2026, serial: 42 });
});

test('parseIssuedCode also parses legacy COMP-0001-2026-0007 (migration seed)', () => {
  assert.deepEqual(parseIssuedCode('COMP-0001-2026-0007'), { year: 2026, serial: 7 });
});

test('parseIssuedCode rejects foreign years and unparseable codes', () => {
  assert.equal(parseIssuedCode('SOF-EMP-2026-0001', 2025), null);
  assert.equal(parseIssuedCode('COMP-0001'), null);
  assert.equal(parseIssuedCode(''), null);
});

// ---------------------------------------------------------------------------
// Joining-year resolution
// ---------------------------------------------------------------------------

test('yearOf reads the calendar year and falls back when unparseable', () => {
  assert.equal(yearOf('2026-05-10'), 2026);
  assert.equal(yearOf(new Date(2025, 10, 2)), 2025);
  assert.equal(yearOf('garbage', 2024), 2024);
  assert.equal(yearOf('', 2024), 2024);
  assert.equal(yearOf(null, 2024), 2024);
  assert.equal(yearOf(undefined, 2024), 2024);
});
