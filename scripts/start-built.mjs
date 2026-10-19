import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
await import('./prepare-local-accounts.mjs');
await import('./sites-env.mjs');
const cli=new URL('../node_modules/wrangler/bin/wrangler.js',import.meta.url);
const args=[fileURLToPath(cli),'dev','--config',fileURLToPath(new URL('../dist/server/wrangler.json',import.meta.url)),'--env-file',fileURLToPath(new URL('../.dev.vars',import.meta.url)),'--local','--persist-to',fileURLToPath(new URL('../.wrangler/state',import.meta.url)),'--ip','127.0.0.1','--port','5173','--inspector-port','0'];
const result=spawnSync(process.execPath,args,{stdio:'inherit',cwd:fileURLToPath(new URL('../',import.meta.url))});
if(result.error)throw result.error;process.exitCode=result.status??1;
