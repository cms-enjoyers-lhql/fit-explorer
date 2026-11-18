import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { request } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const temporary=await mkdtemp(path.join(tmpdir(),'fit-explorer-server-test-')),base=path.join(temporary,'site');await mkdir(base);
await writeFile(path.join(base,'index.html'),'test viewer');await writeFile(path.join(temporary,'outside.txt'),'outside fixture');
let link=false;try{await symlink(path.join(temporary,'outside.txt'),path.join(base,'outside.txt'));link=true}catch(error){if(!['EPERM','EACCES'].includes(error.code))throw error}
const server=spawn(process.execPath,[fileURLToPath(new URL('../scripts/serve.mjs',import.meta.url)),'--directory',base,'--port','0'],{stdio:['ignore','pipe','pipe']});
try{
 const address=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Server start timed out')),10000);server.on('error',reject);server.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:\d+\//);if(match){clearTimeout(timer);resolve(new URL(match[0]))}});server.on('exit',code=>{clearTimeout(timer);reject(Error('Server exited '+code))})});
 const get=(pathname,options={})=>new Promise((resolve,reject)=>{const req=request({hostname:address.hostname,port:address.port,path:pathname,...options},res=>{let body='';res.setEncoding('utf8');res.on('data',v=>body+=v);res.on('end',()=>resolve({code:res.statusCode,body,headers:res.headers}))});req.on('error',reject);req.end()});
 assert.equal((await get('/')).body,'test viewer');assert.equal((await get('/',{method:'HEAD'})).body,'');
 assert.equal((await get('/',{method:'POST'})).code,405);assert.equal((await get('/',{headers:{Host:'example.invalid'}})).code,403);
 const traversal=await get('/%2e%2e/outside.txt');assert.notEqual(traversal.body,'outside fixture');assert.ok([403,404].includes(traversal.code));
 if(link)assert.equal((await get('/outside.txt')).code,403);
 assert.equal((await get('/')).headers['cache-control'],'no-store');console.log('PASS: read-only loopback server, host/path/symlink boundaries');
}finally{if(server.exitCode===null&&server.signalCode===null){const exited=new Promise(resolve=>server.once('exit',resolve));server.kill('SIGTERM');await exited}await rm(temporary,{recursive:true,force:true})}
