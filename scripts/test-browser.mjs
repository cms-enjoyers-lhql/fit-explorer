import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),args=process.argv.slice(2);
const option=name=>{const i=args.indexOf(name);return i<0?null:args[i+1]};
const output=path.resolve(option('--output')??path.join(root,'qa','browser-'+Date.now()));
await mkdir(output,{recursive:true});
const common=args.filter((_,i)=>args[i]!=='--output'&&args[i-1]!=='--output');
if(!common.includes('--url'))common.push('--url',pathToFileURL(path.join(root,'dist/fit-explorer.html')).href);
for(const [file,folder]of [['generic_browser.mjs','generic'],['labels_browser.mjs','labels'],['drop_browser.mjs','drop']]){
 const code=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.join(root,'tests',file),...common,'--output',path.join(output,folder)],{cwd:root,stdio:'inherit'});child.on('error',reject);child.on('exit',resolve)});
 if(code!==0){process.exitCode=code??1;break}
}
