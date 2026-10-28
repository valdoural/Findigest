/**
 * Выводы ИИ на листах отчёта. Генерирует основной процесс (insights/insights.js), здесь — только показ.
 *   • «Доходы и расходы»: выводы заменяют пример в карточке «Разбор последних трёх месяцев»;
 *   • остальные листы: карточка «Выводы ИИ» под заголовком листа;
 *   • без ИИ или без данных Zenmoney карточки не показываются (на «Доходах и расходах» остаётся пример).
 * Тон вывода: warn — красная точка (как сигналы отчёта), good — зелёная, info — нейтральная.
 */
(function () {
  'use strict';
  const N = window.fdNative;
  if (!N || !N.insights) return;
  const I = N.insights;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const NAME = { anthropic: 'Claude', openai: 'GPT', gemini: 'Gemini', mock: 'тест' };
  const when = iso => { const d = new Date(iso), p = n => String(n).padStart(2, '0'); return `${p(d.getDate())}.${p(d.getMonth() + 1)}, ${p(d.getHours())}:${p(d.getMinutes())}`; };
  const REFRESH = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 3v5h5"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 21v-5h-5"/></svg>';

  /* ---------- карточки ---------- */
  const cards = {};
  for (const sec of document.querySelectorAll('section.sheet')) {
    const id = sec.id;
    let card, body, own = false;
    const ana = id === 'sheet2' && sec.querySelector('[data-fd="anaTitle"]');
    const sig = id === 'sheet1' && sec.querySelector('#fd-sigcard');   // «Баланс»: выводы ИИ живут вместе с «Сигналами дня»
    if (sig) {
      card = sig;
      body = document.createElement('div'); body.className = 'fd-ai-body';
      const list = card.querySelector('#sigs');
      card.fdSigTitle = card.querySelector('h2');
      card.fdSigSplit = document.createElement('p'); card.fdSigSplit.className = 'fd-sig-split'; card.fdSigSplit.textContent = 'Сигналы по данным';
      list.before(card.fdSigSplit);
      card.fdBodyBefore = card.fdSigSplit;
    } else if (ana) {
      card = ana.closest('.c');
      body = document.createElement('div'); body.className = 'fd-ai-body';
      // пример оставляем на месте до первых выводов
      card.fdExample = [...card.children].filter(e => e !== ana);
    } else {
      own = true;
      card = document.createElement('div');
      card.className = 'c mb fd-ai'; card.hidden = true;
      card.innerHTML = '<h2>Выводы ИИ</h2>';
      body = document.createElement('div'); body.className = 'fd-ai-body';
      const sub = sec.querySelector(':scope > .sub') || sec.querySelector(':scope > h1');
      if (!sub) continue;
      // ключевые цифры листа (ряд карточек без заголовка) остаются первыми, выводы — сразу за ними
      const next = sub.nextElementSibling;
      (next && !next.querySelector('h2') ? next : sub).after(card);
    }
    const h2 = card.querySelector('h2');
    const head = document.createElement('div'); head.className = 'hdrow fd-ai-head';
    h2.replaceWith(head); head.appendChild(h2); h2.style.margin = '0';
    const meta = document.createElement('div'); meta.className = 'fd-ai-meta';
    meta.innerHTML = `<span class="nt fd-ai-when"></span><button class="bn gh fd-ai-btn" type="button">${REFRESH}<span>Обновить выводы</span></button>`;
    head.appendChild(meta);
    card.classList.add('fd-ai-card');
    card.setAttribute('aria-live', 'polite');
    if (card.fdBodyBefore) card.fdBodyBefore.before(body); else card.appendChild(body);
    cards[id] = { card, body, meta, own, ana: !!ana || !!sig, sig: !!sig };
  }

  let st = null, busy = false, err = null;

  function render() {
    const s = st || {};
    const ready = !!(s.available && s.hasData);
    for (const [id, c] of Object.entries(cards)) {
      const items = (s.sheets && s.sheets[id]) || [];
      const btn = c.meta.querySelector('button'), lab = btn.querySelector('span');
      const show = ready && (items.length || c.ana || !s.sheets);
      if (c.own) c.card.hidden = !show;
      // пример с условными цифрами в «Разборе» — только пока нет ИИ или данных
      if (c.card.fdExample) c.card.fdExample.forEach(e => { e.hidden = ready; });
      c.meta.hidden = !ready;
      c.body.hidden = !ready;
      if (c.sig) {   // заголовок общей карточки «Баланса»: без ИИ — просто «Сигналы дня»
        c.card.fdSigTitle.textContent = ready ? 'Выводы ИИ и сигналы дня' : 'Сигналы дня';
        c.card.fdSigSplit.hidden = !(ready && items.length);
      }
      if (!ready) continue;
      btn.disabled = busy; btn.setAttribute('aria-busy', String(busy));
      const left = Math.ceil((waitUntil - Date.now()) / 1000);
      lab.textContent = busy ? (left > 0 ? `Лимит ИИ, повтор через ${left} с…` : 'Анализирую…') : s.sheets ? 'Обновить выводы' : 'Сформировать выводы';
      c.meta.querySelector('.fd-ai-when').textContent = s.at ? `${NAME[s.provider] || s.provider} · ${when(s.at)}` : '';
      let html = '';
      if (busy && !s.sheets) html = '<div class="fd-ai-skel" aria-hidden="true"><i></i><i></i><i></i></div>';
      else if (!s.sheets) html = '<p class="nt">ИИ разберёт ваши данные и напишет короткие выводы к каждому листу: что изменилось, почему и что проверить. Обычно это занимает 10–30 секунд.</p>';
      else if (!items.length) html = c.sig ? '' : '<p class="nt">По этому листу данных для выводов пока мало.</p>';
      else html = items.map(x => `<p class="sig fd-t-${esc(x.tone)}${x.tone === 'good' ? ' g' : ''}">${x.tag ? `<b>${esc(x.tag)}:</b> ` : ''}${esc(x.text)}</p>`).join('');
      const e = err || (s.error && s.error.message);
      if (e) html += `<p class="nt fd-ai-err" role="status">Не удалось обновить выводы: ${esc(e)}</p>`;
      if (c.body.fdHtml !== html) { c.body.innerHTML = html; c.body.fdHtml = html; } // без лишней перерисовки — иначе выводы «мигали» бы при каждом фокусе окна
      c.body.classList.toggle('busy', busy && !!s.sheets);
    }
  }

  async function load() { try { st = await I.get(); } catch (_) { st = null; } render(); }
  async function run() {
    if (busy) return;
    busy = true; err = null; render();
    try { st = await I.refresh(); } catch (e) { err = e.message || String(e); }
    busy = false; waitUntil = 0; render();
  }
  document.addEventListener('click', e => { if (e.target.closest && e.target.closest('.fd-ai-btn')) run(); });
  let waitUntil = 0;
  I.onState(s => { if (s && s.running) { busy = true; waitUntil = s.waitMs ? Date.now() + s.waitMs : 0; render(); } });
  // лимит ИИ «в минуту»: показываем обратный отсчёт до повтора
  setInterval(() => { if (busy && waitUntil > Date.now()) render(); }, 1000);
  I.onUpdated(s => { busy = !!(s && s.running); waitUntil = 0; st = s; err = null; render(); });
  // подключили ИИ или обновили данные — состояние меняется
  if (N.digest && N.digest.onUpdated) N.digest.onUpdated(() => setTimeout(load, 300));
  window.addEventListener('focus', () => { if (!busy) load(); });
  load();
})();
