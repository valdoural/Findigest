#!/usr/bin/env node
'use strict';
/**
 * Переносит веб-версию отчёта в приложение с МИНИМАЛЬНЫМИ правками:
 * разметка, размеры, графики и логика листов не меняются. Правки только такие:
 *   • шрифты, pdf.js и xlsx — из локальной папки vendor (приложение работает без интернета);
 *   • подключается мост bridge.js (база/ИИ/сохранение файлов вместо облачных);
 *   • вверху рядом с кнопкой «Данные» — кнопка «Подключения»;
 *   • блок «Привязка почты mail.ru» убран с листа «Питание» (перенесён в «Подключения»);
 *   • тексты подсказок про ИИ — под настольную версию.
 * Каждая замена проверяется: если исходник изменился и шаблон не найден — скрипт падает,
 * чтобы правка не потерялась молча.
 *
 * Запуск: node scripts/prepare-digest.js [путь к веб-версии]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = process.argv[2] || path.join(ROOT, 'reference', 'digest.web.html');
const OUT = path.join(ROOT, 'src', 'renderer', 'digest', 'index.html');

let s = fs.readFileSync(SRC, 'utf8');

// Снимаем внешнюю обёртку, которую добавляет просмотрщик артефактов (если есть).
const second = s.toLowerCase().indexOf('<!doctype html>', 10);
if (second > 0) {
  s = s.slice(second);
  const tail = s.lastIndexOf('</body></html>');
  if (tail > 0 && s.indexOf('</html>') < tail) s = s.slice(0, tail).trimEnd() + '\n';
}

function rep(find, replace, { all = false } = {}) {
  const n = s.split(find).length - 1;
  if (!n) throw new Error('Шаблон не найден: ' + String(find).slice(0, 90));
  s = all ? s.split(find).join(replace) : s.replace(find, replace);
}

// 1. Шрифты и библиотеки — локально
rep(/<link rel="preconnect"[^>]*>\s*<link rel="preconnect"[^>]*>\s*<link href="https:\/\/fonts\.googleapis\.com[^>]*>/,
  '<link rel="stylesheet" href="vendor/fonts.css">\n<link rel="stylesheet" href="../desktop/connections.css">\n<link rel="stylesheet" href="../desktop/shell.css">\n<link rel="stylesheet" href="../desktop/assistant.css">\n<link rel="stylesheet" href="../desktop/insights.css">\n<link rel="stylesheet" href="../desktop/skins.css">\n<link rel="stylesheet" href="../desktop/controls.css">');
rep('<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>',
  '<script src="../desktop/bridge.js"></script>\n<script src="vendor/pdf.min.js"></script>');
rep("'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'", "'vendor/pdf.worker.min.js'");
rep("'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'", "'vendor/xlsx.full.min.js'");

// 2. Кнопка «Подключения» слева от «Данные»
const PLUG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 2v5"/><path d="M15 2v5"/><path d="M6 7h12v3a6 6 0 0 1-12 0z"/><path d="M12 16v6"/></svg>';
const SYNC = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 3v5h5"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 21v-5h-5"/></svg>';
rep('<button class="ib" id="dmb"',
  `<button class="ib" id="rfb" type="button" aria-label="Обновить данные Zenmoney" data-tip="Обновить данные Zenmoney">${SYNC}</button><button class="ib" id="cnb" type="button" aria-expanded="false" aria-controls="cnp" aria-label="Подключения: ИИ, Zenmoney, почта" data-tip="Подключения: ИИ, Zenmoney, почта">${PLUG}<i class="cn-dot" id="cnd" aria-hidden="true"></i></button><button class="ib" id="dmb"`);

// 3. Почта — из листа «Питание» в «Подключения»
rep(/<h3>Привязка почты mail\.ru<\/h3>[\s\S]*?<button class="bn" type="button" disabled>Подключить почту \(нужна серверная часть\)<\/button>/,
  '<p class="nt" style="margin-top:12px">Автозагрузка чеков из почты и адреса отправителей магазинов настраиваются в <button class="bn gh" type="button" data-open-conn="mail" style="min-height:34px;padding:0 10px">Подключения → Почта</button></p>');
rep('<span style="flex:1;margin-left:12px;max-width:260px"><input type="email" value="${esc(MAILS[s.n]||\'\')}" data-shop="${esc(s.n)}" placeholder="адрес отправителя чеков" aria-label="Почта: ${esc(s.n)}"></span>', '');
rep("$('mq').innerHTML=mailQ()", "($('mq')&&($('mq').innerHTML=mailQ()))", { all: true });

// 4. Тексты про ИИ и хранилище
rep('Распознавание ИИ недоступно в этом просмотре (нет доступа к Claude). Откройте дайджест в claude.ai или приложении Claude и разрешите доступ. Без ИИ: ',
  'ИИ не подключён. Откройте «Подключения» (кнопка со штекером вверху) и добавьте ключ Claude, Gemini или GPT. Без ИИ: ');
rep("Фото распознаёт только ИИ: откройте дайджест в claude.ai или приложении Claude либо вставьте текст чека",
  'Фото распознаёт только ИИ: подключите Claude, Gemini или GPT в «Подключениях» либо вставьте текст чека');
rep('Для фото нужно разрешение на изображения (Claude)', 'Выбранная модель ИИ не принимает изображения — выберите другую в «Подключениях»');
rep("c==='not_granted'?'доступ к Claude не разрешён.':",
  "c==='not_granted'?'ИИ не подключён — добавьте ключ в «Подключениях».':c==='auth'?'ключ ИИ не принят — проверьте его в «Подключениях».':c==='region'?'сервис ИИ недоступен из вашего региона — укажите прокси в «Подключениях».':c==='network'||c==='timeout'?'нет связи с сервисом ИИ, повторите позже.':c==='model'?'модель ИИ не найдена — выберите другую в «Подключениях».':");
rep("'Данные хранятся в вашей приватной базе (видны только вам).':'База недоступна в этом просмотре: данные сохраняются только в этом браузере. Используйте экспорт, чтобы их не потерять.'",
  "'Данные хранятся в локальной базе на этом компьютере (папка данных — в «Подключениях»).':'Локальная база недоступна: данные сохраняются только во временном хранилище окна. Используйте экспорт, чтобы их не потерять.'");

// 6. Живые данные Zenmoney.
//    Каждая константа снимка превращается в «FDD.X ?? <прежнее значение>»: если синхронизации ещё не было,
//    отчёт показывает данные веб-версии, после синхронизации — пересчитанные из Zenmoney.
function liveConst(name, key = name) {
  const at = s.indexOf(`const ${name}=`);
  if (at < 0) throw new Error('Не найдена константа ' + name);
  const st = at + `const ${name}=`.length;
  const open = s[st], close = open === '[' ? ']' : open === '{' ? '}' : null;
  if (!close) throw new Error('Константа ' + name + ' не литерал');
  let depth = 0, k = st, q = null;
  for (; k < s.length; k++) {
    const c = s[k];
    if (q) { if (c === '\\') { k++; continue; } if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === open) depth++;
    else if (c === close && --depth === 0) break;
  }
  s = s.slice(0, st) + `FDD.${key}??` + s.slice(st, k + 1) + s.slice(k + 1);
}
function liveInner(name, key) { // для «…,FM=[…]» внутри одной строки const
  const re = new RegExp(`([,\\s])${name}=\\[`);
  const m = re.exec(s);
  if (!m) throw new Error('Не найдено ' + name);
  const st = m.index + m[1].length + name.length + 1;
  s = s.slice(0, st) + `FDD.${key}??` + s.slice(st);
}

// 6.1 Ожидание данных: основной скрипт отчёта начинается после их загрузки
rep('<script>(async()=>{\n', `<script>(async()=>{
const FDD=(await (window.FD_READY||Promise.resolve(null)))||{};const FDM=FDD.meta||null;const YCUR=FDM?FDM.year:2026;
/* подписи, зависящие от даты данных */
const FDX=(()=>{if(!FDM)return {};const n0=v=>Math.round(v).toLocaleString('ru-RU'),dmy=d=>d.slice(8,10)+'.'+d.slice(5,7)+'.'+d.slice(0,4);
 const g={};(FDD.signals.refunds||[]).forEach(r=>{const k=r.catName&&r.cat!==r.catName&&r.catName!=='Займ'?r.catName.toLowerCase()+' — подарки и возмещения':r.cat;(g[k]=g[k]||{s:0,w:[]}).s+=r.sum;if(r.who&&!g[k].w.includes(r.who))g[k].w.push(r.who)});
 const rt=Object.values(g).reduce((a,x)=>a+x.s,0),rp=Object.entries(g).sort((a,b)=>b[1].s-a[1].s).map(([c,x])=>c.toLowerCase()+' ('+n0(x.s)+(x.w.length?': '+x.w.slice(0,3).join(', '):'')+')');
 const big=(FDD.signals.bigUnexplained||[]);
 return {refunds:rp.length?'Возвраты '+n0(rt)+' ₽ учтены: '+rp.join(', ')+'.':'Возвратов в этом месяце нет.',
  sigs:big.length?['<p class="sig">Крупные операции без пояснений за 15 мес.: '+big.map(b=>(b.sum>=1e6?(b.sum/1e6).toFixed(2).replace('.',',')+' млн':n0(b.sum/1000)+' тыс.')+' — '+b.kind+', '+dmy(b.date)).join('; ')+'.</p>']:[],
  text:{snapshot:'Данные Zenmoney: история с '+FDM.firstDmy+', операции до '+FDM.lastDmy+(FDD.syncedAt?' (обновлено '+FDD.syncedAt+')':'')+'. Расходы учтены с возвратами.',
   heroNote:'остатки на '+FDM.today.slice(8,10)+'.'+FDM.today.slice(5,7)+' по Zenmoney',cumTitle:'Расходы нарастающим итогом, '+FDM.monName,
   pyNote:'Расходы считаются как в Zenmoney: возврат уменьшает расход в день поступления, «Корректировка» — тоже расход. «Прошлый год» — '+FDM.pyName+'; выключатель убирает разовые траты от 100 тыс. ₽ (обычно это корректировки остатков).',
   fcNote:'Серый фон — прогноз (медиана за '+FDM.fm3Label+'), тонкая полоса — текущий расход. Нажмите категорию, чтобы увидеть её на графике.',
   cumHist:'Накопленный итог за '+FDM.windowMonths+' мес. (с '+FDM.monStart.slice(5,7)+'.'+FDM.monStart.slice(0,4)+')',
   capHist:'Свободные деньги и ипотека за '+FDM.windowMonths+' мес. (с '+FDM.monStart.slice(5,7)+'.'+FDM.monStart.slice(0,4)+')',
   anaNote:''}}})();
if(FDX.text)document.querySelectorAll('[data-fd]').forEach(e=>{const v=FDX.text[e.dataset.fd];if(v!=null){e.textContent=v;e.hidden=!v}});
`);
// 6.2 Наборы данных
for (const n of ['TX', 'HIST', 'FM3', 'CATN', 'SEP', 'PY', 'MS', 'MON', 'AC', 'UT', 'SEPCAT', 'PYCAT']) liveConst(n);
liveConst('KL'); liveInner('FM', 'FM'); liveInner('MM', 'MM');
rep(/while\(TX\.length<31\)TX\.push\(\[\]\);\n(TX\[12\]\.push[^\n]*)\n/, (m, a) => `if(!FDD.TX){while(TX.length<31)TX.push([]);\n${a}}\n`);
rep('INC=364860,ZP=275478', 'INC=FDD.INC??364860,ZP=FDD.ZP??275478');
rep('const SEP_TOT=155320.54,SEPS=SEP.map(v=>v*SEP_TOT/133491);', 'const SEP_TOT=FDD.SEP_TOT??155320.54,SEPS=SEP.map(v=>v*SEP_TOT/(FDD.SEP?SEP_TOT||1:133491));');
// параметры: остатки, ипотека и платёж — из Zenmoney, допущения (прирост, ставка, ключевая) — пользователя
rep("const P=Object.assign({fr:3065711,mb:3001999,mp:28016.62,sv:143700,rt:12,key:14},CG('par',{}));",
  "const P=Object.assign({fr:3065711,mb:3001999,mp:28016.62,sv:143700,rt:12,key:14},CG('par',{}),FDD.P||{});");
// подписи месяцев от начала истории
rep("const ml2=i=>{const m=2+i;return('0'+(m%12+1)).slice(-2)+'.'+(24+Math.floor(m/12))};",
  "const MS0=FDM?(+FDM.monStart.slice(2,4))*12+(+FDM.monStart.slice(5,7)-1):290;const ml2=i=>{const m=MS0+i;return('0'+(m%12+1)).slice(-2)+'.'+String(Math.floor(m/12)).padStart(2,'0')};");
rep('const mm=2+i,y=2024+Math.floor(mm/12)', 'const mm=MS0-288+i,y=2024+Math.floor(mm/12)');
rep("$('yt').innerHTML=[['2024 (апр.–дек.)',1,10],['2025',10,22],['2026 (янв.–окт.)',22,32]]",
  "$('yt').innerHTML=(FDM?(()=>{const y0=+FDM.monStart.slice(0,4),m0=+FDM.monStart.slice(5,7),y1=FDM.year,c=+FDM.curMonth.slice(5,7),SH=['янв.','фев.','мар.','апр.','мая','июн.','июл.','авг.','сен.','окт.','ноя.','дек.'],r=[];for(let y=y0;y<=y1;y++){const a=y===y0?m0:1,b=y===y1?c:12,s=(y-y0)*12+a-m0;r.push([y+((a>1||b<12)?' ('+SH[a-1]+'–'+SH[b-1]+')':''),Math.max(0,s),s+b-a+1])}return r})():[['2024 (апр.–дек.)',1,10],['2025',10,22],['2026 (янв.–окт.)',22,32]])");
// сравнение лет
rep('const Y25=MON.slice(10,22)', 'const Y25=FDD.Y_PREV??MON.slice(10,22)');
rep(',Y26=MON.slice(22,32)', ',Y26=FDD.Y_CUR??MON.slice(22,32)');
rep('2026 нарастающим: ', '${YCUR} нарастающим: ');
rep('2025 нарастающим: ', '${YCUR-1} нарастающим: ');
rep("prevY:'прошлый год (окт. 2025)',yy:'2026 | 2025 по месяцам'", "prevY:'прошлый год ('+(FDM?FDM.pyLabel:'окт. 2025')+')',yy:YCUR+' | '+(YCUR-1)+' по месяцам'");
// дневной график текущего месяца
rep("last:26,dots:true,len:31,mn:'окт.'", "last:FDM?FDM.day:26,dots:true,len:FDM?FDM.monthLen:31,mn:FDM?FDM.monShort:'окт.'");
rep('Расходы на ${di+1} окт. (с возвратами)', "Расходы на ${di+1} ${FDM?FDM.monShort:'окт.'} (с возвратами)");
rep('Зарплата и аванс (на 23.10)', "Зарплата и аванс (на ${FDM?FDM.zpDate:'23.10'})");
rep('now=new Date(2026,9,1)', 'now=FDM?new Date(+FDM.curMonth.slice(0,4),+FDM.curMonth.slice(5,7)-1,1):new Date(2026,9,1)');
// сигналы листа 1
rep(/Возвраты 26 768 ₽ учтены: кафе \(18 000: [^)]*\), алкоголь \(2 300\), Ozon \(1 468\) и займ \(5 000\)\./,
  "${FDX.refunds??'Пример: возвраты 2 240 ₽ учтены в расходах месяца.'}");
rep(/,'<p class="sig">Развлечения: 0 из 28 000[^']*<\/p>','<p class="sig g">Ozon:[^']*<\/p>','<p class="sig">Крупные операции без пояснений:[^']*<\/p>'\]/,
  m => `,...(FDX.sigs??[${m.slice(1, -1)}])]`);
// ЖКХ: средние и пик от текущей даты
rep(/\(function\(\)\{const s=\(a,b\)=>\{let x=0;for\(let i=a;i<b;i\+\+\)x\+=UT\[i\];return x\};\$\('uk'\)\.innerHTML=`[\s\S]*?`\}\)\(\);/,
  m => `if(FDM){const L=UT.length,s=(a,b)=>{let x=0;for(let i=Math.max(0,a);i<b;i++)x+=UT[i];return x};let w=-1;for(let i=L-3;i>=0;i--)if(ml2(i).startsWith('12.')){w=i;break}const pk=UT.reduce((b,v,i)=>v>UT[b]?i:b,0);$('uk').innerHTML=\`<div class="kp"><span class="l">Среднее за 6 мес. (\${ml2(L-6)}–\${ml2(L-1)})</span><b class="amt">\${N(s(L-6,L)/6)} ₽</b></div><div class="kp"><span class="l">Зима (\${w>=0?ml2(w)+'–'+ml2(w+2):'—'}), в среднем</span><b class="amt">\${N(w>=0?s(w,w+3)/3:0)} ₽</b></div><div class="kp"><span class="l">Пик месяца</span><b class="amt">\${N(UT[pk])} ₽ (\${ml2(pk)})</b></div>\`}else ${m}`);
// тексты разметки с датой снимка
rep('<p class="sub">Снимок Zenmoney: история с 30.03.2024, операции до 26.10.2026. Расходы учтены с возвратами.</p>',
  '<p class="sub" data-fd="snapshot">Снимок Zenmoney: история с 30.03.2024, операции до 26.10.2026. Расходы учтены с возвратами.</p>');
rep('<div class="nt pos amt">остатки на 26.10 по Zenmoney</div>', '<div class="nt pos amt" data-fd="heroNote">остатки на 26.10 по Zenmoney</div>');
rep(/<h2>Расходы нарастающим итогом, октябрь<\/h2>/, '<h2 data-fd="cumTitle">Расходы нарастающим итогом, октябрь</h2>');
rep('«Прошлый год» — октябрь 2025 без записей «Корректировка» (904 671, 218 000 и 150 000 ₽ — изменения остатков, а не траты).',
  '<span data-fd="pyNote">«Прошлый год» — октябрь 2025 без записей «Корректировка» (904 671, 218 000 и 150 000 ₽ — изменения остатков, а не траты).</span>');
rep('<p class="nt" id="cn">Серый фон — прогноз', '<p class="nt" id="cn" data-fd="fcNote">Серый фон — прогноз');
rep(/(<h2>Август–октябрь 2026: разбор<\/h2>)/, '$1<p class="nt" data-fd="anaNote" hidden></p>');

// 6.3 Графики истории — за выбранное окно (по умолчанию 24 месяца), подписи «с …» от начала окна
rep('<h2>Накопленный итог с 03.2024</h2>', '<h2 data-fd="cumHist">Накопленный итог с 03.2024</h2>');
rep('<h2>Свободные деньги и ипотека с 03.2024</h2>', '<h2 data-fd="capHist">Свободные деньги и ипотека с 03.2024</h2>');
rep('(с 03.2024: ${', '(с ${KL[0]}: ${');
rep('по Zenmoney с 03.2024;', 'по Zenmoney с ${MLAB[0]};');

// 7. Чеки из почты: если в чеке нет даты, берём дату письма, а не сегодняшнюю
rep("(/^\\d{4}-\\d{2}-\\d{2}$/.test(d.date||'')?d.date:NOW.toISOString().slice(0,10));\n   RCP=RCP",
  "(/^\\d{4}-\\d{2}-\\d{2}$/.test(d.date||'')?d.date:(e.maildate||NOW.toISOString().slice(0,10)));\n   RCP=RCP");

// 8. Обезличивание: в установщике не остаётся ни одной личной цифры или факта из веб-версии.
//    Наборы данных «по умолчанию» (до подключения Zenmoney) — условные, из scripts/demo-data.js; тексты — нейтральные.
{
  const demo = require('./demo-data');
  const D0 = demo.make();
  const lit = v => JSON.stringify(v);
  function replaceLitAfter(marker, value) {
    const at = s.indexOf(marker);
    if (at < 0) throw new Error('Обезличивание: не найдено ' + marker);
    const st = at + marker.length, open = s[st], close = open === '[' ? ']' : '}';
    let depth = 0, k = st, q = null;
    for (; k < s.length; k++) {
      const c = s[k];
      if (q) { if (c === '\\') { k++; continue; } if (c === q) q = null; continue; }
      if (c === '"' || c === "'" || c === '`') { q = c; continue; }
      if (c === open) depth++; else if (c === close && --depth === 0) break;
    }
    s = s.slice(0, st) + value + s.slice(k + 1);
  }
  for (const n of ['TX', 'HIST', 'SEP', 'PY', 'MS', 'MON', 'AC', 'UT', 'SEPCAT', 'PYCAT', 'KL', 'FM', 'MM']) replaceLitAfter(`FDD.${n}??`, lit(D0[n]));
  rep('INC=FDD.INC??364860,ZP=FDD.ZP??275478', `INC=FDD.INC??${D0.INC},ZP=FDD.ZP??${D0.ZP}`);
  rep(/if\(!FDD\.TX\)\{while\(TX\.length<31\)TX\.push\(\[\]\);\n[^\n]*\}\n/, '');
  rep('const SEP_TOT=FDD.SEP_TOT??155320.54', 'const SEP_TOT=FDD.SEP_TOT??133491');
  rep('/* прошлый месяц: дневная форма из выгрузки, итог приведён к отчёту Zenmoney за сентябрь (155 320,54 ₽) */', '/* прошлый месяц: дневная форма; без данных Zenmoney — условный пример */');
  rep("const P=Object.assign({fr:3065711,mb:3001999,mp:28016.62,sv:143700,rt:12,key:14}", `const P=Object.assign(${lit(D0.P)}`);
  rep('m[1]-(i===9?1122670.97:0)', 'm[1]');
  rep('m[1]-(i===1?1580000:i===9?10933:0)', 'm[1]');
  // ЖКХ: условная квитанция на 50 м²
  replaceLitAfter('const SEED=', lit(demo.SEED));
  rep("IT.push({p:'2026-09',t:'ЭСК',n:'Электроэнергия (по нормативу)',q:188,r:4.5,s:846})", "IT.push({p:'2026-09',t:'ЭСК',n:'Электроэнергия (по нормативу)',q:150,r:4.5,s:675})");
  {
    const g = n => demo.SEED.filter(x => n.test(x[0])).reduce((a, x) => a + x[3], 0);
    const Gd = [['Содержание жилья', g(/^Содержание/)], ['Услуги по дому (10 позиций по м²)', g(/Уборка|Мониторинг|ТО |ковриков|МАФ|Клининг|Праздники|Новогоднее/)], ['Ресурсы на общее имущество', g(/СОИ/)],
      ['Горячая вода (подача и нагрев)', g(/^ГВС, (подача|нагрев)/)], ['Обращение с ТКО', g(/ТКО/)], ['Капремонт', g(/капремонт/)], ['Электроэнергия', 675]].map(([n, v]) => [n, Math.round(v * 100) / 100]);
    const tot = Math.round(Gd.reduce((a, x) => a + x[1], 0) * 100) / 100;
    replaceLitAfter('const Gd=', lit(Gd));
    rep('g[1]/6927.4*100', `g[1]/${tot}*100`);
  }
  rep(/<div class="kp"><span class="l">Всего за месяц: УК 4 877,56[\s\S]*?иначе статистика ЖКХ занижена\.<\/p>/,
    '<div id="rsb"></div><p class="sig">Пример разбора по условной квитанции на 50 м². После загрузки ваших квитанций (архив ниже) здесь будет разбор по ним: что зависит от площади, а что от потребления, начисления по нормативу и изменения тарифов.</p>');
  rep('Капремонт — из квитанций (отдельный платёжный документ): 1 118,72 ₽ в 2025 году, 1 203,84 ₽ в 2026-м.', 'Капремонт — из квитанций (отдельный платёжный документ).');
  rep("<b class=\"amt\">17 176 ₽ (12.2025)</b>", "<b class=\"amt\">${N(Math.max(...UT))} ₽ (${ml2(UT.indexOf(Math.max(...UT)))})</b>");
  rep('<h2>Разбор квитанций за сентябрь 2026</h2>', '<h2>Разбор квитанции</h2>');
  // дом и квартира
  rep(/<p class="sub" id="ptl">[^<]*ЖК[^<]*<\/p>/, '<p class="sub" id="ptl">Квартира: параметры ниже условные — замените своими</p>');
  for (const [id, v] of [['pa', '50'], ['pm', '150000'], ['pc', '5400000'], ['pd', '1100000'], ['pl', '4300000'], ['pr', '900000'], ['pb', '2021-06'], ['pp', '24500'], ['tn', '150000'], ['te', '100000'], ['tf', '25000'], ['ha', '12000'], ['hf', '17'], ['hn', '250'], ['hr', '55']])
    rep(new RegExp(`(<input id="${id}" type="[a-z]+" value=")[^"]*(")`), `$1${v}$2`);
  rep(/<p class="nt">Цена за м² — по свежему объявлению в этом ЖК[^<]*<\/p>/, '<p class="nt">Цена за м² — ориентир по объявлениям в вашем доме, замените на оценку Домклик. Цену покупки, взнос и ремонт введите сами; сумма ипотеки и платёж подтянутся из Zenmoney.</p>');
  rep("f('Площадь МОП 4 748,5 м²',(4748.5/(a||1)*100)", "f('Площадь МОП 3 000 м² (условно)',(3000/(a||1)*100)");
  rep('Площадь дома и МОП — из квитанции УК; этажность и число квартир условные, замените своими.', 'Площадь дома и МОП, этажность и число квартир условные — замените данными из квитанции УК.');
  // лист «Баланс»: подписи без личных фактов
  rep("' ₽/мес · кредитка Ozon: 0 из 120 000 ₽'", "' ₽/мес'");
  rep(/FDX\.sigs\?\?\[[^\]]*\]/, "FDX.sigs??['<p class=\"sig\">Пример: здесь появятся крупные операции без категории и корректировки остатков — после подключения Zenmoney.</p>']");
  rep('Остатки на конец месяца по Zenmoney; долларовый счёт до мая 2025 не учтён — там была стартовая корректировка. Резкие скачки (10.25, 01–02.26, 05.26) — переводы на счета вне Zenmoney.',
    'Остатки на конец месяца по Zenmoney; валютные счета учитываются с первой операции. Резкие скачки — обычно переводы на счета вне Zenmoney.');
  // лист «Доходы и расходы»
  rep(/<span data-fd="pyNote">«Прошлый год» — октябрь 2025 без записей «Корректировка» \([^)]*\)\.<\/span>/, '<span data-fd="pyNote">Расходы считаются как в Zenmoney: возврат уменьшает расход в день поступления. «Прошлый год» — тот же месяц год назад.</span>');
  rep('В 2025–2026 есть разовые крупные поступления и траты (переводы между своими счетами, корректировки, 1,64 млн накоплений в мае 2026): годовые итоги ориентировочные.',
    'Разовые крупные поступления и траты (переводы между своими счетами, корректировки) делают годовые итоги ориентировочными.');
  rep(/(<h2>Август–октябрь 2026: разбор<\/h2><p class="nt" data-fd="anaNote" hidden><\/p>)[\s\S]*?(Источник: отчёт Zenmoney за август–октябрь 2026[^<]*<\/p>)/,
    '<h2 data-fd="anaTitle">Разбор последних трёх месяцев</h2><p class="nt">Пример. Разбор готовит подключённый ИИ по вашим данным: где расходы выросли, какие операции стоит проверить, что изменить. Цифры ниже условные.</p>' +
    '<p class="sig"><b>Расходы:</b> по сравнению с прошлым месяцем выросли на 12%, основной вклад — кафе и покупки.</p>' +
    '<p class="sig g"><b>Сбережения:</b> отложено около четверти дохода — темп совпадает с целью на листе «Баланс и цели».</p>' +
    '<p class="sig"><b>Проверить:</b> две крупные операции без категории — это может быть перевод между своими счетами.</p>');
  rep('<p class="sub" data-fd="snapshot">Снимок Zenmoney: история с 30.03.2024, операции до 26.10.2026. Расходы учтены с возвратами.</p>',
    '<p class="sub" data-fd="snapshot">Условные данные для примера. Подключите Zenmoney — появятся ваши.</p>');
  rep('<div class="nt pos amt" data-fd="heroNote">остатки на 26.10 по Zenmoney</div>', '<div class="nt pos amt" data-fd="heroNote">условный пример</div>');
  // плашка «условные данные», пока не подключён ни один источник
  rep("if(FDX.text)document.querySelectorAll('[data-fd]')", "if(!FDM){document.documentElement.classList.add('fd-demo')}\nif(FDX.text)document.querySelectorAll('[data-fd]')");
  rep('Итог: зарплата и сбережения заметно выше ориентиров, расходы на кафе и алкоголь тоже выше.', 'Колонка «Вы» считается по вашим данным за три последних закрытых месяца.');
  rep('<td class="pos"><b>46%</b></td>', '<td><b id="yv-sv"></b></td>');
  rep('<td><b>17,4</b></td>', '<td><b id="yv-pr"></b></td>');
  rep('<td class="neg"><b>11,6</b></td>', '<td><b id="yv-cf"></b></td>');
  rep('<td class="neg"><b>3,6</b></td>', '<td><b id="yv-al"></b></td>');
  rep(/(const MON=FDD\.MON\?\?\[[^\n]*?\];)/, `$1
{/* колонка «Вы»: норма сбережений и доли трат за три закрытых месяца */const L=MON.length,q=MON.slice(Math.max(0,L-4),L-1),inc=q.reduce((a,m)=>a+m[0],0),out=q.reduce((a,m)=>a+m[1],0),H=Object.values(HIST),tot=H.reduce((a,h)=>a+Object.values(h).reduce((x,y)=>x+y,0),0)||1,sh=n=>H.reduce((a,h)=>a+(h[n]||0),0)/tot*100,f=v=>v.toFixed(1).replace('.',','),put=(id,t,c)=>{const e=document.getElementById(id);if(e){e.textContent=t;e.className=c||''}};
 const sr=inc?(inc-out)/inc*100:0;put('yv-sv',Math.round(sr)+'%',sr>=10?'pos':sr<0?'neg':'');put('yv-pr',f(sh('Продукты')));put('yv-cf',f(sh('Кафе и рестораны')),sh('Кафе и рестораны')>5?'neg':'');put('yv-al',f(sh('Алкоголь')),sh('Алкоголь')>2?'neg':'')}`);
}

// 5. Модуль «Подключения» — последним
rep(/<\/body>\s*<\/html>\s*$/, '<script src="../desktop/shell.js"></script>\n<script src="../desktop/connections.js"></script>\n<script src="../desktop/refresh.js"></script>\n<script src="../desktop/table-import.js"></script>\n<script src="../desktop/import.js"></script>\n<script src="../desktop/insights.js"></script>\n<script src="../desktop/logos.js"></script>\n<script src="../desktop/overlay.js"></script>\n<script src="../desktop/datepicker.js"></script>\n<script src="../desktop/about.js"></script>\n<script src="../desktop/region.js"></script>\n<script src="../desktop/assets.js"></script>\n<script src="../desktop/assistant.js"></script>\n</body>\n</html>\n');

// 8.5 Шкала графика «Свободные деньги и ипотека» — по данным (в веб-версии была зашита −0,7…4 млн)
rep("mkChart($('kc'),{W:760,H:250,cat:true,lo:-700,hi:4000,step:3,",
  "mkChart($('kc'),{W:760,H:250,cat:true,...(()=>{const mn=Math.min(0,...ND),mx=Math.max(1,...FM,...MM,...ND);for(const st of [250,500,1000,1500,2000,2500,5000,10000,20000]){const lo=-Math.ceil(-mn/st)*st,hi=lo+4*st;if(hi>=mx*1.03)return{lo,hi}}return{lo:mn,hi:mx*1.06}})(),step:3,");

// 8.6 Подпись под счетами: теперь логотипы банков загружаются с их сайтов
rep('<p class="nt">Буквенные обозначения счетов, не логотипы банков.</p>', '<p class="nt">Логотипы — с сайтов банков; если логотип не найден, показана буква.</p>');

// 8.7 Цвета категорий — 16 проверенных цветов (--cat1…16, desktop/controls.css; у вариантов оформления первые 8 свои)
rep("function sliceColor(i){return `hsl(${(i*137.508)%360} 62% ${i%2?46:54}%)`}",
  "function sliceColor(i){const v=getComputedStyle(document.documentElement).getPropertyValue('--cat'+(i%16+1)).trim();return v||`hsl(${(i*137.508)%360} 62% ${i%2?46:54}%)`}");

// 8.8 «Баланс и цели»: «Справка» — рядом с «Целями», «Категории» — справа от графика расходов (видно их вклад сразу),
//     «Сигналы дня» (с выводами ИИ) — сразу после плашек с цифрами. Блоки переносятся целиком, с их id и обработчиками.
{
  const divEnd = (t, i) => { const re = /<(\/?)div\b[^>]*>/g; re.lastIndex = i; let d = 0, m; while ((m = re.exec(t))) { d += m[1] ? -1 : 1; if (!d) return re.lastIndex; } throw new Error('div не закрыт'); };
  const a = s.indexOf('<section class="sheet on" id="sheet1"'), z = s.indexOf('</section>', a);
  let sec = s.slice(a, z);
  const take = start => { const i = sec.indexOf(start); if (i < 0) throw new Error('Не найден блок: ' + start.slice(0, 60)); return [i, divEnd(sec, i)]; };
  const [gA, gB] = take('<div class="c mb"><h2>Цели и прогноз</h2>');
  const [r1A, r1B] = take('<div class="bt"><div class="c s8"><h2 data-fd="cumTitle">');
  const [r2A, r2B] = take('<div class="bt"><div class="c s8"><h2>Категории на выбранную дату</h2>');
  if (!(gB <= r1A && r1B <= r2A)) throw new Error('Порядок блоков «Баланса» изменился');
  const goals = sec.slice(gA, gB).replace('<div class="c mb">', '<div class="c s8">');
  const row1 = sec.slice(r1A, r1B), row2 = sec.slice(r2A, r2B);
  const inner = row => { const k = row.indexOf('<div class="c s'); return [row.slice(k, divEnd(row, k)), row.slice(divEnd(row, k)).replace(/<\/div>\s*$/, '').trim()]; };
  const [chart, help] = inner(row1), [cats, sigs] = inner(row2);
  const catsNarrow = cats.replace('<div class="c s8">', '<div class="c s5">');   // пропорция 7:5 — как «Траты на продукты по дням | Группы» на листе «Продукты»
  const sigsCol = sigs.replace('<div class="c s4">', '<div class="c">');
  const helpCol = help.replace('<div class="c s4">', '<div class="c">');
  const chartFix = chart.replace('категории ниже покажут накопленные суммы на эту дату', 'категории справа покажут накопленные суммы на эту дату');
  // «Сигналы дня» (вместе с выводами ИИ) — сразу после плашек с цифрами; затем «Цели» | «Справка»; «График» | «Категории» (7:5)
  const chartCol = chartFix.replace('<div class="c s8">', '<div class="c s7">');
  const sigsTop = sigs.replace('<div class="c s4">', '<div class="c mb" id="fd-sigcard">');
  const out = `${sigsTop} <div class="bt" id="fd-goalrow">${goals} ${help}</div> <div class="bt">${chartCol} ${catsNarrow}</div>`;
  sec = sec.slice(0, gA) + out + sec.slice(r2B);
  s = s.slice(0, a) + sec + s.slice(z);
}

// 8.9 Панели «Данные» и окно задач скрываются плавно (desktop/shell.css): без !important у [hidden]
rep('.dmp[hidden]{display:none!important}', '.dmp[hidden]{display:none}');
rep('.job[hidden]{display:none!important}', '.job[hidden]{display:none}');

// 8.10 Лист «Питание» называется «Продукты» (вкладка, заголовок, нижняя панель); «Здоровое питание» — по смыслу остаётся
rep('<span class="tl">Питание</span><span class="ts" aria-hidden="true">Чеки</span>', '<span class="tl">Продукты</span><span class="ts" aria-hidden="true">Продукты</span>');
rep('<h1>Питание</h1>', '<h1>Продукты</h1>');
// 8.12 «Динамика расходов и доходов»: столбцы «Баланс ±» полупрозрачные — на первом плане линии дохода и расхода
rep("cf:v=>v>=0?'var(--pos)':'var(--neg)'", "cf:v=>v>=0?'color-mix(in srgb,var(--pos) 38%,transparent)':'color-mix(in srgb,var(--neg) 38%,transparent)'");
rep('<span><i style="--c:var(--pos)"></i>Баланс +</span><span><i style="--c:var(--neg)"></i>Баланс −</span>', '<span><i style="--c:color-mix(in srgb,var(--pos) 38%,transparent)"></i>Баланс +</span><span><i style="--c:color-mix(in srgb,var(--neg) 38%,transparent)"></i>Баланс −</span>');
// 8.13 «Вы против региона и РФ»: субъект РФ выбирается из списка, ориентиры находит ИИ (desktop/region.js, main/insights/region.js)
{
  const a = s.indexOf('<div class="c mb"><h2>Вы против Свердловской области и РФ</h2>');
  if (a < 0) throw new Error('Не найден блок сравнения с регионом');
  const z = s.indexOf('</div>', s.indexOf('Колонка «Вы» считается', a)) + 6;
  const row = (t, you, k) => `<tr><td>${t}</td><td><b ${you}></b></td><td id="rg-${k}">—</td><td id="rf-${k}">—</td></tr>`;
  s = s.slice(0, a) + `<div class="c mb" id="fd-region"><div class="fd-reg-head"><h2>Вы, регион и РФ</h2>
 <label class="fd-reg-pick"><span>Субъект РФ</span><select id="rg-sel" aria-label="Субъект РФ для сравнения"><option>Свердловская область</option></select></label>
 <button class="bn gh" id="rg-ref" type="button">Найти данные</button></div>
<div class="sc"><table><thead><tr><th>Показатель</th><th>Вы</th><th id="rg-th">Регион</th><th>РФ</th></tr></thead><tbody>
${row('Зарплата до налогов, мес.', 'class="amt" id="mg"', 'salary')}
${row('Норма сбережений', 'id="yv-sv"', 'savings')}
${row('Продукты, % трат', 'id="yv-pr"', 'food')}
${row('Кафе и рестораны, % трат', 'id="yv-cf"', 'cafe')}
${row('Алкоголь, % трат', 'id="yv-al"', 'alcohol')}</tbody></table></div>
<p class="nt" id="rg-note">Колонка «Вы» считается по вашим данным за три последних закрытых месяца.</p></div>` + s.slice(z);
}
rep('Помесячная история Zenmoney и сравнение с официальными ориентирами по РФ и Свердловской области', 'Помесячная история Zenmoney и сравнение с официальными ориентирами по РФ и вашему региону');
rep('const S=Math.sqrt(2*Math.log(114.7/75)),M=[Math.log(75e3),Math.log(94.8e3/(114.7/75))]',
  'const RG=window.FD_REGION||{},RM=RG.rfMean||114.7e3,RD=RG.rfMedian||75e3,S=Math.sqrt(2*Math.log(RM/RD)),M=[Math.log(RD),Math.log((RG.salary||94.8e3)/(RM/RD))]');
rep('<br>Свердл. обл.: ${f(M[1])}', '<br>${RG.short||\'Свердл. обл.\'}: ${f(M[1])}');
rep('</i>Свердл. обл.: выше ≈', '</i>${RG.short||\'Свердл. обл.\'}: выше ≈');
rep('aria-label="Модельное распределение зарплат РФ и Свердловской области с отметкой вашего дохода"', 'aria-label="Модельное распределение зарплат РФ и выбранного региона с отметкой вашего дохода"');
rep('Для Свердловской области медиана принята пропорционально РФ.', 'Для региона медиана принята пропорционально РФ.');
// 8.11 «Пассивный доход сейчас»: «(из листа 1)» — ссылка на «Баланс и цели»
rep("$('ix').textContent=`Цель ${N(target)} ₽/мес ${pg?'(из листа 1)':'(цель не задана на листе 1)'}",
  "$('ix').innerHTML=`Цель ${N(target)} ₽/мес ${pg?'(из листа <a href=\"#sheet1\" data-go=\"sheet1\">«Баланс и цели»</a>)':'(цель не задана на листе <a href=\"#sheet1\" data-go=\"sheet1\">«Баланс и цели»</a>)'}");

// 8.14 Сравнение в «Расходах нарастающим итогом»: расходы считаются как в Zenmoney (корректировки — тоже расход),
// поэтому выключатель «без разовых трат от 100 тыс.» убирает такие траты не только из средних, но и из линий
// «прошлый месяц» и «прошлый год» (данные — SEP_BIG / PY_BIG из digest/build.js).
rep("cmp:{prev:SEPS,prevY:PY,months:MS}", "cmp:{prev:SEPS,prevY:PY,months:MS,prevBig:FDD.SEP_BIG||[],prevYBig:FDD.PY_BIG||[]}");
rep("if(mode==='prev')return cumOf(c.cmp.prev);if(mode==='prevY')return cumOf(c.cmp.prevY);",
  "const nb=(a,b)=>c.excl()&&b?a.map((v,i)=>v-(b[i]||0)):a;if(mode==='prev')return cumOf(nb(c.cmp.prev,c.cmp.prevBig));if(mode==='prevY')return cumOf(nb(c.cmp.prevY,c.cmp.prevYBig));");
rep('<span id="exd">Без трат более 100 тыс. ₽ в средних</span>', '<span id="exd">Без разовых трат от 100 тыс. ₽ в сравнении</span>');
rep('без «Корректировка»), средние по месяцам */', 'расходы как в Zenmoney), средние по месяцам */');

// 8.15 «Стоимость: история и оценки»: график в карточке s7 — того же масштаба, что «Расходы нарастающим итогом»;
// архив записей — рядом, в карточке s5 (раньше всё было на всю ширину и график вырастал вдвое)
rep('<div class="c s12"><h2>Стоимость: история и оценки</h2>', '<div class="c s7" id="vcard"><h2>Стоимость: история и оценки</h2>');
rep('<p class="nt" id="vt" aria-live="polite"></p><details id="vdet" open style="margin-top:10px"><summary>Архив записей (<span id="vn">0</span>)</summary><div class="sc"><table><tbody id="vlist"></tbody></table></div></details></div>',
  '<p class="nt" id="vt" aria-live="polite"></p></div><div class="c s5" id="varch"><h2>Архив оценок <small class="nt" style="font-weight:400">(<span id="vn">0</span>)</small></h2><p class="nt">Ваши оценки по датам, новые сверху. Удалить запись — крестик в строке.</p><div class="sc"><table><tbody id="vlist"></tbody></table></div></div>');

// 8.16 Окно подтверждения: своя надпись на кнопке (например, «Установить» для обновления); по умолчанию — красная «Удалить»
rep("function askConfirm(text){return new Promise(res=>{const ov=$('cf');$('cfT').textContent=text;",
  "function askConfirm(text,ok){return new Promise(res=>{const ov=$('cf');$('cfT').textContent=text;$('cfY').textContent=ok||'Удалить';$('cfY').style.background=ok?'var(--ac)':'var(--neg)';");

// 9. Доступ модулей программы (импорт таблиц и др.) к данным отчёта: основной скрипт — асинхронная функция,
//    его переменные снаружи не видны, поэтому в её конце публикуется небольшой интерфейс window.FD_PAGE.
{
  const a = s.indexOf('<script>(async()=>{');
  const b = s.indexOf('\n})();\n', a);
  if (a < 0 || b < 0 || b > s.indexOf('</script>', a)) throw new Error('Не найден конец основного скрипта отчёта');
  s = s.slice(0, b) + `
window.FD_PAGE={get IT(){return IT},set IT(v){IT=v},get RCP(){return RCP},set RCP(v){RCP=v},CS,CG,renderAll,sRefresh,askConfirm,addFiles,loadXlsx};
window.dispatchEvent(new Event('fd-page'));` + s.slice(b);
}

fs.writeFileSync(OUT, s);
console.log('Готово:', path.relative(ROOT, OUT), (s.length / 1024).toFixed(0) + ' КБ');
