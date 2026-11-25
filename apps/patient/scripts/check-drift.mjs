import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const sourceRoot = fileURLToPath(new URL('../../../', import.meta.url));
export const childRoot = fileURLToPath(new URL('../', import.meta.url));
export function safeRelativePath(value) {
  return typeof value === 'string' && value.length > 0 && !value.includes('\\')
    && !path.isAbsolute(value) && !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)
    && !value.split('/').some(part => part === '..' || part === '.' || part === '');
}
function contained(root, target) {
  const relative = path.relative(root, target);
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

/**
 * Pure verification when supplied an in-memory upstream reader.
 * @param {unknown} rows
 * @param {(source: string) => Uint8Array | string} readSource
 * @param {{ targetExists?: (target: string) => boolean, readOwned?: (target: string) => Uint8Array | string }} [options]
 */
export function verifyProvenance(rows, readSource, options = {}) {
  const failures = [], seen = new Set();
  let targetCount = 0;
  if (!Array.isArray(rows) || rows.length === 0) return { passed: false, sourceCount: 0, targetCount, failures: [{ code: 'invalid_manifest', source: '', message: 'Expected a nonempty provenance array' }] };
  for (const row of rows) {
    const owned = row?.mode === 'package-owned';
    if (!row || !safeRelativePath(row.source) || !/^[0-9a-f]{64}$/.test(row.sourceSha256 || '')
        || !['copied', 'adapted', 'package-owned'].includes(row.mode) || !Array.isArray(row.targets) || row.targets.length === 0
        || row.targets.some(target => !safeRelativePath(target))
        || (owned && (row.targets.length !== 1 || row.targets[0] !== row.source))) {
      failures.push({ code: 'invalid_entry', source: row?.source || '', message: 'Invalid source/hash/mode/child target path' });
      continue;
    }
    if (seen.has(row.source)) { failures.push({ code: 'duplicate_source', source: row.source, message: 'Combine duplicate source targets' }); continue; }
    seen.add(row.source);
    targetCount += row.targets.length;
    try {
      const bytes = owned ? options.readOwned(row.source) : readSource(row.source);
      const actual = createHash('sha256').update(bytes).digest('hex');
      if (actual !== row.sourceSha256) failures.push({
        code: 'hash_mismatch', source: row.source, expected: row.sourceSha256, actual, targets: row.targets,
        message: owned ? 'Package-owned source changed; review and update its recorded hash' : 'Upstream source changed; review copied/adapted targets',
      });
    } catch {
      failures.push({ code: owned ? 'target_missing' : 'source_missing', source: row.source,
        message: owned ? 'Package-owned source missing or outside package' : 'Upstream source missing or outside repository' });
      if (owned) continue;
    }
    for (const target of row.targets) {
      if (options.targetExists && !options.targetExists(target)) failures.push({ code: 'target_missing', source: row.source, target, message: 'Child target missing or outside package' });
    }
  }
  return { passed: failures.length === 0, sourceCount: seen.size, targetCount, failures };
}

export function verifyRepositoryProvenance(rows, repository = sourceRoot, child = childRoot, ref = process.env.PATIENT_PROVENANCE_REF) {
  const realRepository = realpathSync(repository), realChild = realpathSync(child);
  const revision = ref ? execFileSync('git', ['rev-parse', '--verify', '--end-of-options', ref + '^{commit}'],
    { cwd: realRepository, encoding: 'utf8' }).trim() : null;
  const readContained = (root, source) => {
    const target = realpathSync(path.resolve(root, source));
    if (!contained(root, target)) throw new Error('Source leaves its root');
    return readFileSync(target);
  };
  const readSource = source => revision
    ? execFileSync('git', ['show', revision + ':' + source], { cwd: realRepository, stdio: ['ignore', 'pipe', 'ignore'] })
    : readContained(realRepository, source);
  return verifyProvenance(rows, readSource, {
    readOwned: target => readContained(realChild, target),
    targetExists: target => {
      const filename = path.resolve(realChild, target);
      return existsSync(filename) && contained(realChild, realpathSync(filename));
    },
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rows = JSON.parse(readFileSync(new URL('../provenance.json', import.meta.url), 'utf8'));
  const result = verifyRepositoryProvenance(rows);
  if (!result.passed) { console.error(JSON.stringify(result, null, 2)); process.exitCode = 1; }
  else console.log('Provenance verified: ' + result.sourceCount + ' sources; ' + result.targetCount + ' child mappings in ' + (process.env.PATIENT_PROVENANCE_REF || sourceRoot));
}
