/** Read-only loopback server. It never opens a browser or accepts uploads. */
import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const args=process.argv.slice(2),arg=(key,fallback)=>{const i=args.indexOf(key);return i<0?fallback:args[i+1]};
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const base=await realpath(path.resolve(arg('--directory',path.join(project,'dist'))));
const port=Number(arg('--port',process.env.PORT??'8080'));
if(!Number.isInteger(port)||port<0||port>65535)throw Error('Use a port between 0 and 65535.');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.root':'application/octet-stream','.txt':'text/plain; charset=utf-8','.png':'image/png','.mp4':'video/mp4'};
const server=createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  const reply=(code,text)=>{res.statusCode=code;res.setHeader('Content-Type','text/plain; charset=utf-8');res.end(text)};
  if(!['GET','HEAD'].includes(req.method))return reply(405,'Read-only server');
  if(!/^(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(req.headers.host??''))return reply(403,'Loopback host required');
  try{
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    let candidate=path.resolve(base,'.'+pathname);
    if(candidate!==base&&!candidate.startsWith(base+path.sep))return reply(403,'Forbidden');
    if((await stat(candidate)).isDirectory())candidate=path.join(candidate,'index.html');
    candidate=await realpath(candidate);
    if(candidate!==base&&!candidate.startsWith(base+path.sep))return reply(403,'Forbidden');
    const bytes=await readFile(candidate);res.setHeader('Content-Type',mime[path.extname(candidate)]??'application/octet-stream');res.setHeader('Content-Length',bytes.length);res.end(req.method==='HEAD'?undefined:bytes);
  }catch(error){return reply(error instanceof URIError?400:404,error instanceof URIError?'Invalid request':'Not found')}
});
server.listen(port,'127.0.0.1',()=>console.log(`Fit Explorer: http://127.0.0.1:${server.address().port}/`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
