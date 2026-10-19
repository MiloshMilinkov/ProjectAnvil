import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
// A separate temporary directory keeps the test database and generated code away
// from the application's persisted local workspace and attachments.
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'projectanvil-backend-check-'));
const files = [
  'app/lib/types.ts', 'app/lib/seed.ts', 'app/lib/workspace-model.ts',
  'app/lib/access-store.ts', 'app/lib/workspace-store.ts',
  'app/api/state/route.ts', 'app/api/media/route.ts', 'app/api/media/[id]/route.ts',
  'app/api/export/route.ts', 'app/api/account/route.ts', 'app/api/teams/route.ts',
];
try {
  fs.writeFileSync(path.join(output, 'package.json'), JSON.stringify({ type: 'commonjs' }));
  for (const relative of files) {
    const source = fs.readFileSync(path.join(root, relative), 'utf8');
    const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } });
    const destination = path.join(output, 'compiled', relative.replace(/\.ts$/, '.js'));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, outputText);
  }
  fs.copyFileSync(path.join(root, 'tests', 'backend.cjs'), path.join(output, 'check.cjs'));
  fs.copyFileSync(path.join(root, 'tests', 'account-boundaries.cjs'), path.join(output, 'account-boundaries.cjs'));
  const result = spawnSync(process.execPath, [path.join(output, 'check.cjs')], {
    cwd: root, stdio: 'inherit', env: { ...process.env, PROJECTANVIL_CHECK_ROOT: root, NODE_PATH: [path.join(root, 'node_modules'), process.env.NODE_PATH].filter(Boolean).join(path.delimiter) },
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(output));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !path.basename(output).startsWith('projectanvil-backend-check-')) throw new Error('Refusing to clean an unexpected test output path.');
  fs.rmSync(output, { recursive: true, force: true });
}
