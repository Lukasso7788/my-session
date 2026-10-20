import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
const base=new URL('../outputs/retention-email-previews/',import.meta.url);
createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  const name=path==='/'?'index.html':path.slice(1);
  if(!/^[a-z0-9_-]+\.(html|txt)$/.test(name)){res.writeHead(404).end();return;}
  try{const body=await readFile(new URL(name,base));res.writeHead(200,{'Content-Type':name.endsWith('.html')?'text/html; charset=utf-8':'text/plain; charset=utf-8'}).end(body);}catch{res.writeHead(404).end();}
}).listen(4212,'127.0.0.1',()=>console.log('Retention previews: http://127.0.0.1:4212/'));
