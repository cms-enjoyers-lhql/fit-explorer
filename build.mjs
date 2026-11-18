import { build } from 'esbuild';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here=path.dirname(fileURLToPath(import.meta.url)),dist=path.join(here,'dist');
const root=await readFile(path.join(here,'examples/twin-gaussian.root'));
if(root.subarray(0,4).toString()!=='root')throw Error('The synthetic example is not a ROOT file.');
await mkdir(path.join(dist,'assets'),{recursive:true});
await build({absWorkingDir:here,define:{__FIT_ROOT_EXAMPLE__:JSON.stringify(root.toString('base64')),process:'undefined'},external:['fs','zlib','tmp','xhr2','@oneidentity/zstd-js'],logOverride:{'empty-import-meta':'silent'},entryPoints:['web/app.js'],outfile:'dist/assets/app.js',bundle:true,format:'iife',globalName:'FitExplorerBundle',minify:true,target:['chrome115','safari17'],legalComments:'linked',sourcemap:false});
const fonts=[];
for(const weight of [400,500,600]){
  const bytes=await readFile(path.join(here,'node_modules/@fontsource/ibm-plex-mono/files',`ibm-plex-mono-latin-${weight}-normal.woff2`));
  fonts.push(`@font-face{font-family:'IBM Plex Mono';font-style:normal;font-weight:${weight};font-display:swap;src:url(data:font/woff2;base64,${bytes.toString('base64')}) format('woff2')}`);
}
const css=fonts.join('\n')+'\n'+await readFile(path.join(here,'web/style.css'),'utf8');
await writeFile(path.join(dist,'assets/app.css'),css);
const notices=[await readFile(path.join(here,'LICENSE'),'utf8')];
for(const name of (await readdir(path.join(here,'LICENSES'))).filter(n=>n.endsWith('.txt')).sort())notices.push(name+'\n'+await readFile(path.join(here,'LICENSES',name),'utf8'));
try{notices.push(await readFile(path.join(dist,'assets/app.js.LEGAL.txt'),'utf8'))}catch(error){if(error.code!=='ENOENT')throw error}
const licenses=notices.join('\n\n');
await writeFile(path.join(dist,'THIRD_PARTY_LICENSES.txt'),licenses);
let html=await readFile(path.join(here,'web/index.html'),'utf8');
html=html.replace(/<link\b[^>]*href=["'][^"']*app\.css["'][^>]*>/,()=>'<style>'+css+'</style>');
const js=await readFile(path.join(dist,'assets/app.js'),'utf8');
html=html.replace(/<script\b[^>]*src=["'][^"']*app\.js["'][^>]*>\s*<\/script>/,()=>'<script type="module">'+js.replace(/<\/script/gi,'<\\/script')+'</script>');
html=html.replace('</body>','<script id="fit-root" type="application/octet-stream">'+root.toString('base64')+'</script></body>');
html=html.replace('</head>','<script type="text/plain" id="bundled-licenses">\n'+licenses.replace(/<\/script/gi,'<\\/script')+'\n</script></head>');
if(/(?:src|href)=["'][^"']*app\.(?:js|css)["']/.test(html))throw Error('Viewer asset inlining failed.');
await writeFile(path.join(dist,'fit-explorer.html'),html);await writeFile(path.join(dist,'index.html'),html);
console.log('Built dist/fit-explorer.html and dist/index.html (offline ROOT viewer).');
