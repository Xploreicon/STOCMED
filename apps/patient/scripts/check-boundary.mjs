import { readFileSync, readdirSync, existsSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export const childRoot = fileURLToPath(new URL('../', import.meta.url));
export const expectedRoutes = ['/', '/about', '/account/delete', '/chat', '/complete-profile', '/dashboard', '/forgot-password', '/history', '/login', '/privacy', '/profile', '/reservations', '/search-results', '/settings', '/signup', '/terms', '/update-password'].sort();
const privateIdentifiers = /(?:SUPABASE_SERVICE_ROLE|ANTHROPIC_|TERMII_|RESEND_|CRON_SECRET|SENTRY_AUTH)/;
const forbiddenImport = /^(?:server-only|next\/headers|@supabase\/ssr|@anthropic-ai\/|@sentry\/)|(?:supabase\/(?:admin|server|request)|SymptomIntakeForm|IntakeStatusTracker|PrescriptionUpload|PharmacyFeaturesProvider|PharmacyReservationsBar|ProductTour)/;
const forbiddenClientModule = /(?:\/node_modules\/(?:@supabase\/ssr|@anthropic-ai\/[^/|]+|@sentry\/[^/|]+)(?:\/|[|?]|$)|\/lib\/supabase\/(?:admin|server|request)(?:\.[cm]?[jt]sx?|\/|[|?]|$)|\/(?:components|lib|hooks|store|stores)\/(?:pharmacy|admin|pos|insights)(?:\/|[|?]|$)|\/app\/(?:\(pharmacy\)|\(admin\)|pharmacy|admin|pos|insights)(?:\/|[|?]|$)|\/(?:SymptomIntakeForm|IntakeStatusTracker|PrescriptionUpload|PharmacyFeaturesProvider|PharmacyReservationsBar|ProductTour)(?:\.[cm]?[jt]sx?|\/|[|?]|$))/;

function walk(dir, generatedWebAssets) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (['node_modules', '.next', 'out', '.git'].includes(entry.name)) return [];
    const filename = path.join(dir, entry.name);
    if (filename === generatedWebAssets) return [];
    return entry.isDirectory() ? walk(filename, generatedWebAssets) : [filename];
  });
}
function contained(root, filename) {
  const relative = path.relative(root, filename);
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}
function resolveLocal(base) {
  const candidates = [base, ...['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.d.ts', '.css', '.svg'].map(ext => base + ext),
    ...['index.ts', 'index.tsx', 'index.js', 'index.jsx', 'index.mjs', 'index.json', 'index.d.ts'].map(name => path.join(base, name))];
  return candidates.find(filename => existsSync(filename) && statSync(filename).isFile());
}

/** Module identifiers are real build-time graph evidence, not string literals. */
export function verifyClientModuleInventory(identifiers) {
  if (!Array.isArray(identifiers) || identifiers.some(identifier => typeof identifier !== 'string')) return ['Invalid client module inventory'];
  return identifiers.filter(identifier => forbiddenClientModule.test(identifier.replaceAll('\\', '/')))
    .map(identifier => 'Excluded client module: ' + identifier);
}

/** Read-only complete source/output scan, also usable with temporary fixtures. */
export function verifyBoundary(childDirectory = childRoot) {
  const child = realpathSync(childDirectory), failures = [], advisoryStrings = [];
  // The iOS sync duplicates the audited export inside the Xcode project.
  const source = walk(child, path.join(child, 'ios/App/App/public')).filter(filename => /\.(?:tsx?|jsx?|mjs|cjs)$/.test(filename) && !filename.includes('/tests/') && !filename.includes('/scripts/'));
  for (const filename of source) {
    if (!contained(child, realpathSync(filename))) { failures.push(filename + ': source symlink leaves package'); continue; }
    const text = readFileSync(filename, 'utf8');
    if (/(?:^|\/)route\.(?:tsx?|jsx?|mjs|cjs)$/.test(filename) || /(?:^|\/)middleware\./.test(filename)) failures.push(filename + ': server entry point');
    if (/['"]use server['"]/.test(text) || /serviceWorker\s*\.\s*register\s*\(/.test(text)) failures.push(filename + ': server action or service worker');
    if (privateIdentifiers.test(text)) failures.push(filename + ': private configuration identifier');
    // Includes imports, re-exports and literal dynamic imports. Copied public
    // type-only imports stay allowed when their resolved target stays local.
    for (const imported of ts.preProcessFile(text, true, true).importedFiles) {
      const name = imported.fileName;
      if (forbiddenImport.test(name)) failures.push(filename + ': forbidden import ' + name);
      if (path.isAbsolute(name) || /^[A-Za-z]:[\\/]/.test(name) || name.startsWith('file:')) { failures.push(filename + ': absolute import ' + name); continue; }
      if (!name.startsWith('.') && !name.startsWith('@/')) continue;
      const base = name.startsWith('@/') ? path.resolve(child, name.slice(2)) : path.resolve(path.dirname(filename), name);
      if (!contained(child, base)) { failures.push(filename + ': import leaves package ' + name); continue; }
      const target = resolveLocal(base);
      if (!target) failures.push(filename + ': local import is unresolved ' + name);
      else if (!contained(child, realpathSync(target))) failures.push(filename + ': import symlink leaves package ' + name);
    }
  }
  const routes = walk(path.join(child, 'app')).filter(filename => /\/page\.tsx$/.test(filename)).map(filename => '/' + path.relative(path.join(child, 'app'), path.dirname(filename)).split(path.sep).filter(part => part && !/^\(.*\)$/.test(part)).join('/')).sort();
  if (JSON.stringify(routes) !== JSON.stringify(expectedRoutes)) failures.push('Unexpected routes: ' + routes.join(', '));
  const native = JSON.parse(readFileSync(path.join(child, 'capacitor.config.json'), 'utf8'));
  if (native.server?.url || native.webDir !== 'out' || native.ios?.appendUserAgent !== 'StocMedApp/1.0') failures.push('Unexpected native packaging configuration');
  const inventoryPath = path.join(child, '.next/client-module-inventory.json');
  let inventoryCount = null;
  if (existsSync(inventoryPath)) {
    const identifiers = JSON.parse(readFileSync(inventoryPath, 'utf8'));
    failures.push(...verifyClientModuleInventory(identifiers));
    inventoryCount = Array.isArray(identifiers) ? identifiers.length : null;
  }
  const output = path.join(child, 'out');
  if (existsSync(output)) {
    for (const filename of walk(output)) {
      if (!contained(child, realpathSync(filename))) { failures.push(filename + ': exported symlink leaves package'); continue; }
      if (!/\.(?:js|html|txt|json)$/.test(filename)) continue;
      const text = readFileSync(filename, 'utf8');
      if (privateIdentifiers.test(text) || /(?:SymptomIntakeForm|IntakeStatusTracker|serviceWorker\s*\.\s*register\s*\(|\/sw\.js)/.test(text)) failures.push(filename + ': excluded runtime or private configuration');
      const offset = text.indexOf('@supabase/ssr');
      if (offset >= 0) advisoryStrings.push({ file: path.relative(child, filename), needle: '@supabase/ssr', offset, classification: inventoryCount === null ? 'diagnostic literal observed; dependency absence is not yet proven without the client-module inventory' : 'literal-only; actual dependency presence is checked against the client module inventory' });
    }
    if (existsSync(path.join(output, 'api')) || existsSync(path.join(output, 'sw.js'))) failures.push('API or service worker exported');
    for (const route of expectedRoutes) if (!existsSync(path.join(output, route, 'index.html'))) failures.push(route + ': missing export');
  }
  return { passed: failures.length === 0, sourceCount: source.length, routes, outputScanned: existsSync(output), inventoryCount, advisoryStrings, failures };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = verifyBoundary();
  if (!result.passed) { console.error(result.failures.join('\n')); process.exitCode = 1; }
  else console.log('Boundary verified: ' + result.sourceCount + ' source files; ' + result.routes.length + ' patient/public routes' + (result.outputScanned ? '; static output scanned' : '') + (result.inventoryCount !== null ? '; ' + result.inventoryCount + ' client modules scanned' : ''));
  if (result.advisoryStrings.length) console.log(JSON.stringify({ advisoryStrings: result.advisoryStrings }, null, 2));
}
