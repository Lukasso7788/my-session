import { mkdir, writeFile } from 'node:fs/promises';
import { RETENTION_KINDS, renderRetentionEmail } from '../api/_lib/retentionTemplates.ts';
const directory = new URL('../outputs/retention-email-previews/', import.meta.url);
await mkdir(directory, { recursive: true });
const sessions = [
  { title: 'One task at a time', host: 'Yaro', startsAt: '2026-10-23T15:00:00Z', duration: 50, url: 'https://mysession.club/sessions' },
  { title: 'A quiet hour together', host: 'Community host', startsAt: '2026-10-23T18:00:00Z', duration: 60, url: 'https://mysession.club/sessions' },
];
const previews = RETENTION_KINDS.map(kind => ({ kind, ...renderRetentionEmail(kind, {
  firstName: 'Alex', timezone: 'Europe/Kyiv', sessions, sessionCount: 3, minutes: 142,
  sessionTitle: 'One task at a time', sessionStart: sessions[0].startsAt,
  sessionUrl: 'https://mysession.club/sessions', unsubscribeUrl: 'https://mysession.club/settings',
}) }));
for (const preview of previews) {
  await writeFile(new URL(`${preview.kind}.html`, directory), preview.html);
  await writeFile(new URL(`${preview.kind}.txt`, directory), `${preview.subject}\n\n${preview.text}`);
}
const labels = ['Первая сессия', 'Вторая сессия', 'Вернуться · 7 дней', 'Вернуться · 14 дней', 'Пропущенная сессия', 'Напоминание о брони', 'Итоги недели'];
await writeFile(new URL('index.html', directory), `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MySession · Email previews</title><style>*{box-sizing:border-box}body{margin:0;background:#e9eff6;color:#18283b;font:14px Inter,Arial,sans-serif}header{padding:28px 32px;background:white;border-bottom:1px solid #dce5ee}h1{margin:0 0 8px;font-size:26px}nav{display:flex;flex-wrap:wrap;gap:8px;padding:20px 32px}button{cursor:pointer;border:1px solid #d3deeb;border-radius:9px;background:white;padding:10px 14px;color:#18283b}button[aria-pressed=true]{background:#3478eb;color:white;border-color:#3478eb}main{max-width:950px;margin:auto;padding:0 16px}#subject{padding:12px 0 18px;font-weight:bold}iframe{display:block;width:100%;height:1120px;border:1px solid #d3deeb;border-radius:16px;background:#eef3f8}p{color:#526479}a{color:#245fc5}</style><header><h1>MySession · Письма, которые возвращают</h1><p>7 готовых превью · демонстрационные имена, даты и сессии. В реальной отправке подставляются актуальные данные.</p></header><nav>${previews.map((p,i)=>`<button data-index="${i}" aria-pressed="${i===0}">${labels[i]}</button>`).join('')}<button id="mobile">Ширина: desktop / mobile</button></nav><main><div id="subject"></div><iframe title="Email preview" id="preview"></iframe></main><script>const previews=${JSON.stringify(previews.map(p=>({kind:p.kind,subject:p.subject}))).replace(/</g,'\\u003c')};const frame=document.getElementById('preview');function show(i){frame.src=previews[i].kind+'.html';document.getElementById('subject').textContent='Subject: '+previews[i].subject;document.querySelectorAll('[data-index]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.index==i))}document.querySelectorAll('[data-index]').forEach(b=>b.onclick=()=>show(+b.dataset.index));document.getElementById('mobile').onclick=()=>{frame.style.maxWidth=frame.style.maxWidth?'':'390px';frame.style.margin='auto'};show(0)</script></html>`);
console.log('7 previews written to', directory.pathname);
