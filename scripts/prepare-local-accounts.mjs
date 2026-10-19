import fs from 'node:fs';
import {randomBytes} from 'node:crypto';
const target=new URL('../.dev.vars',import.meta.url);
let existing=fs.existsSync(target)?fs.readFileSync(target,'utf8'):'';
if(!/^BETTER_AUTH_SECRET\s*=/m.test(existing)){
  fs.writeFileSync(target,existing+(existing.endsWith('\n')||!existing?'':'\n')+'BETTER_AUTH_SECRET='+randomBytes(48).toString('base64url')+'\n');
  console.log('Local account signing secret initialized.');
}
