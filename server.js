import fs from 'node:fs';
import http from 'node:http';
import Anthropic from '@anthropic-ai/sdk';
import crypto from 'node:crypto';
import cron from 'node-cron';
import { load, save } from './store.js';
import { runRoutine } from './manager.js';

const TOKEN = process.env.ADMIN_TOKEN || '';
const LIMIT = +process.env.DAILY_LIMIT || 10;
const PORT = process.env.PORT || 3000;
if (TOKEN.length < 24) { console.error('Defina ADMIN_TOKEN com pelo menos 24 caracteres.'); process.exit(1); }

const today = () => new Date().toISOString().slice(0, 10);
const same = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const authed = req => same((req.headers.authorization || '').replace(/^Bearer /, ''), TOKEN);
const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': type + '; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};
const body = (req, max = 1e5) => new Promise((ok, no) => {
  let s = '';
  req.on('data', c => { s += c; if (s.length > max) { req.destroy(); no(new Error('grande')); } });
  req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch (e) { no(e); } });
});

const PAGE = `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Aprovações</title>
<style>body{font:16px system-ui;margin:0;padding:16px;background:#f2f7f6;color:#10201d}.c{background:#fff;border-radius:16px;padding:16px;margin:12px 0}p{white-space:pre-wrap}button{font:inherit;padding:10px 16px;border:0;border-radius:12px;margin:4px 8px 0 0;background:#10b981;color:#fff}button.r{background:#dc2626}</style>
<h1>Aprovações do Gerente IA</h1><div id=l></div>
<script>
let T=sessionStorage.t||'';
const api=(p,m)=>fetch(p,{method:m||'GET',headers:{Authorization:'Bearer '+T}});
const btn=(t,f,c)=>{const b=document.createElement('button');b.textContent=t;b.className=c||'';b.onclick=f;return b};
async function dec(id,a){await api('/api/items/'+id+'/'+a,'POST');load()}
async function load(){
  const r=await api('/api/items?status=pendente');
  if(r.status===401){T=prompt('Token de acesso')||'';sessionStorage.t=T;return T?load():0}
  const l=await r.json(),o=document.getElementById('l');o.textContent=l.length?'':'Nada pendente.';
  l.forEach(i=>{const c=document.createElement('div');c.className='c';
    const h=document.createElement('b');h.textContent=i.tipo+' · '+i.produto+' · '+i.canal+(i.tipo==='campanha'?' · R$ '+i.orcamento:'');
    const p=document.createElement('p');p.textContent=(i.titulo?i.titulo+'\\n':'')+i.texto+'\\n'+(i.hashtags||'');
    c.append(h,p,btn('Aprovar',()=>dec(i.id,'approve')),btn('Rejeitar',()=>dec(i.id,'reject'),'r'));o.append(c)})}
load();
</script>`;

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/health') return send(res, 200, { ok: true });
    if (url.pathname === '/approve' && req.method === 'GET') return send(res, 200, PAGE, 'text/html'); // página vazia; os dados exigem o token
    if ((url.pathname === '/' || url.pathname === '/painel') && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" });
      return res.end(fs.readFileSync(new URL('./painel.html', import.meta.url))); // página sem dados; os dados exigem o token
    }
    if (!authed(req)) return send(res, 401, { erro: 'não autorizado' });
    const d = load(); let m;

    if (url.pathname === '/api/items' && req.method === 'GET') {
      const s = url.searchParams.get('status');
      return send(res, 200, d.items.filter(i => !s || i.status === s));
    }
    if ((m = url.pathname.match(/^\/api\/items\/([\w-]+)\/(approve|reject|published)$/)) && req.method === 'POST') {
      const it = d.items.find(i => i.id === m[1]);
      if (!it) return send(res, 404, { erro: 'não encontrado' });
      if (m[2] === 'published') {
        if (it.status !== 'aprovado') return send(res, 409, { erro: 'só itens aprovados podem ser publicados' });
        it.status = 'publicado';
      } else {
        if (it.status !== 'pendente') return send(res, 409, { erro: 'item já decidido' });
        if (m[2] === 'approve' && it.tipo === 'campanha') {
          const gasto = d.spent[today()] || 0;
          if (gasto + it.orcamento > LIMIT) return send(res, 409, { erro: 'excede o limite diário' });
          d.spent[today()] = gasto + it.orcamento;
        }
        it.status = m[2] === 'approve' ? 'aprovado' : 'rejeitado';
      }
      save(d); return send(res, 200, it);
    }
    if (url.pathname === '/api/queue/due' && req.method === 'GET') {
      const agora = new Date().toISOString();
      return send(res, 200, d.items.filter(i => i.tipo === 'post' && i.status === 'aprovado' && i.quando <= agora));
    }
    if (url.pathname === '/api/products' && req.method === 'GET') return send(res, 200, d.products);
    if (url.pathname === '/api/products' && req.method === 'POST') {
      const b = await body(req);
      if (!b.nome || !/^https?:\/\//i.test(b.link || '')) return send(res, 400, { erro: 'informe nome e link https' });
      d.products.push({ nome: String(b.nome).slice(0, 120), plataforma: String(b.plataforma || '').slice(0, 40), preco: +b.preco || 0, comissao: +b.comissao || 0, link: b.link });
      save(d); return send(res, 201, { ok: true });
    }
    if (url.pathname === '/api/state' && req.method === 'GET') return send(res, 200, d.panel || {});
    if (url.pathname === '/api/state' && req.method === 'PUT') {
      const b = await body(req, 1e6);
      if (!b || typeof b !== 'object' || !Array.isArray(b.products)) return send(res, 400, { erro: 'estado inválido' });
      const dd = load();
      dd.panel = b;
      dd.products = b.products.slice(0, 200).map(p => ({ nome: String(p.n || '').slice(0, 120), plataforma: String(p.pl || '').slice(0, 40), preco: +p.pr || 0, comissao: +p.cm || 0, link: /^https?:\/\//i.test(p.lk || '') ? p.lk : '' })).filter(p => p.nome);
      save(dd); return send(res, 200, { ok: true });
    }
    if (url.pathname === '/api/ai' && req.method === 'POST') {
      const prompt = String((await body(req, 2e4)).prompt || '').slice(0, 8000);
      if (!prompt) return send(res, 400, { erro: 'prompt vazio' });
      const dd = load(), n = (dd.ai && dd.ai[today()]) || 0;
      if (n >= (+process.env.AI_DAILY_CAP || 100)) return send(res, 429, { erro: 'limite diário de chamadas de IA atingido' });
      dd.ai = { [today()]: n + 1 }; save(dd);
      const r = await new Anthropic().messages.create({ model: process.env.MODEL || 'claude-sonnet-5-5', max_tokens: 1500, messages: [{ role: 'user', content: prompt }] });
      return send(res, 200, { text: r.content.filter(x => x.type === 'text').map(x => x.text).join('') });
    }
    if (url.pathname === '/api/routine' && req.method === 'POST') return send(res, 200, await runRoutine());
    send(res, 404, { erro: 'rota inexistente' });
  } catch (e) { console.error(e); send(res, 500, { erro: 'erro interno' }); }
}).listen(PORT, () => console.log('Gerente IA no ar na porta ' + PORT));

cron.schedule(process.env.CRON || '0 8 * * *', () => runRoutine().then(r => console.log('rotina', r)).catch(console.error), { timezone: process.env.TIMEZONE || 'America/Fortaleza' });
