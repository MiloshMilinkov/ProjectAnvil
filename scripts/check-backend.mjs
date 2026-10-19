import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, '.sites-runtime', 'backend-check');
const files = [
  'app/lib/types.ts', 'app/lib/seed.ts', 'app/lib/workspace-model.ts', 'app/lib/workspace-store.ts',
  'app/api/state/route.ts', 'app/api/media/route.ts', 'app/api/media/[id]/route.ts', 'app/api/export/route.ts',
];
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, 'package.json'), JSON.stringify({ type: 'commonjs' }));
for (const relative of files) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } });
  const destination = path.join(output, 'compiled', relative.replace(/\.ts$/, '.js'));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, outputText);
}
fs.copyFileSync(path.join(root, 'tests', 'backend.cjs'), path.join(output, 'check.cjs'));
const result = spawnSync(process.execPath, [path.join(output, 'check.cjs')], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
