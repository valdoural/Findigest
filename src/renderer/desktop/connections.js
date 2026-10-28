/**
 * Панель «Подключения» (кнопка со штекером в шапке, рядом с «Данные»).
 * Разделы: ИИ (Claude / Gemini / GPT), Zenmoney, Почта, Сеть и данные.
 * Ключи уходят в основной процесс и сохраняются в отдельный зашифрованный secrets.json;
 * обратно в окно приходит только «задан / не задан» и последние 4 символа.
 */
(function () {
  'use strict';
  const N = window.fdNative;
  if (!N) return;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const LOGO = { anthropic: ['#C8643B', 'Cl'], openai: ['#10A37F', 'GPT'], gemini: ['#4B6BF0', 'Ge'] };
  const ERR = {
    auth: 'ключ или пароль не принят', region: 'сервис недоступен из вашего региона — укажите прокси в разделе «Сеть и данные»',
    network: 'нет связи с сервером', timeout: 'сервер не ответил вовремя', rate_limited: 'слишком много запросов, повторите позже',
    model: 'модель не найдена', server: 'ошибка на стороне сервиса',
  };
  const errText = e => (ERR[e && e.code] ? ERR[e.code] + '.' : '') + (e && e.message && !ERR[e.code] ? ' ' + e.message : '');

  let S = null;            // текущий статус из основного процесса
  let tab = 'ai';
  const models = {};       // загруженные списки моделей по провайдерам
  let aiDirty = false;

  /* ---------- каркас панели ---------- */
  const panel = document.createElement('div');
  panel.id = 'cnp';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'false');
  panel.setAttribute('aria-labelledby', 'cnh');
  panel.hidden = true;
  panel.innerHTML = `
    <div class="ddh"><h2 id="cnh">Подключения</h2><button class="nb" id="cnx" type="button" aria-label="Закрыть">×</button></div>
    <p class="nt" style="margin:4px 0 0">Ключи и пароли хранятся отдельно от отчёта — в зашифрованном файле <b>secrets.json</b> на этом компьютере.</p>
    <div class="cn-tabs" role="tablist" aria-label="Разделы подключений">
      <button role="tab" data-t="ai" type="button"><i id="ct-ai"></i>ИИ</button>
      <button role="tab" data-t="zen" type="button"><i id="ct-zen"></i>Zenmoney</button>
      <button role="tab" data-t="mail" type="button"><i id="ct-mail"></i>Почта</button>
      <button role="tab" data-t="upd" type="button"><i id="ct-upd"></i>Обновление</button>
      <button role="tab" data-t="sys" type="button"><i id="ct-sys" class="ok"></i>Сеть и данные</button>
    </div>
    <section class="cn-sec" data-sec="ai" role="tabpanel"></section>
    <section class="cn-sec" data-sec="zen" role="tabpanel"></section>
    <section class="cn-sec" data-sec="mail" role="tabpanel"></section>
    <section class="cn-sec" data-sec="upd" role="tabpanel"></section>
    <section class="cn-sec" data-sec="sys" role="tabpanel"></section>
    <div class="cn-apply" id="cnap" hidden><span>Настройки ИИ изменены — перезагрузите отчёт, чтобы разбор чеков и квитанций начал их использовать.</span><button class="bn" type="button" id="cnre">Перезагрузить</button></div>`;
  document.body.appendChild(panel);
  const sec = name => panel.querySelector(`[data-sec="${name}"]`);

  const btn = $('cnb');
  function open(on, which, silent) {
    if (which) tab = which;
    panel.hidden = !on;
    // при закрытии панели раскрытые, но так и не заполненные карточки ИИ убираем
    if (!on && S && S.ai) for (const p of S.ai) if (blank(p)) delete expanded[p.id];
    if (btn) btn.setAttribute('aria-expanded', String(on));
    if (on) refresh();             // другие панели закрывает desktop/overlay.js
    else if (btn && !silent) btn.focus();
  }
  window.FD_closeConnections = () => open(false, null, true);
  if (btn) btn.onclick = () => open(panel.hidden);
  $('cnx').onclick = () => open(false);
  $('cnre').onclick = () => N.app.reload();
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) open(false); });
  document.addEventListener('click', e => {
    const g = e.target.closest('[data-open-conn]');
    if (g) { e.preventDefault(); open(true, g.dataset.openConn); return; }
    // кнопка внутри панели могла перерисоваться (исчезнуть из документа) — это не клик «снаружи»
    if (!panel.hidden && e.target.isConnected && !panel.contains(e.target) && !(btn && btn.contains(e.target))) open(false);
  });
  panel.querySelector('.cn-tabs').onclick = e => { const b = e.target.closest('[data-t]'); if (b) { tab = b.dataset.t; paintTabs(); } };

  function paintTabs() {
    panel.querySelectorAll('.cn-tabs [data-t]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.t === tab)));
    panel.querySelectorAll('.cn-sec').forEach(s => s.classList.toggle('on', s.dataset.sec === tab));
  }

  const msg = (el, text, kind) => { if (!el) return; el.textContent = text || ''; el.className = 'cn-msg' + (kind ? ' ' + kind : ''); };
  async function act(el, fn, okText) {
    msg(el, 'Проверяю…');
    try { const r = await fn(); msg(el, typeof okText === 'function' ? okText(r) : okText, 'ok'); return r; }
    catch (e) { msg(el, 'Ошибка: ' + errText(e), 'err'); return null; }
  }
  const sw = (id, on, label) => `<input type="checkbox" role="switch" class="cn-swi" id="${id}" ${on ? 'checked' : ''} aria-label="${esc(label)}" title="${esc(label)}">`;
  const keyInput = (id, set, tail, ph) => `<label>${set ? 'Ключ сохранён (…' + esc(tail) + '). Новый заменит его' : ph}<input class="cn-key" id="${id}" type="password" autocomplete="off" spellcheck="false" placeholder="${set ? '•••• ' + esc(tail) : 'вставьте сюда'}"></label>`;

  /* ---------- ИИ ---------- */
  function dirty() { aiDirty = true; $('cnap').hidden = false; }   // настройки ИИ изменены — предложить перезагрузить отчёт
  const expanded = {};   // какие карточки «Добавить ИИ» раскрыты
  const GROUPS = [['world', 'Мировые'], ['ru', 'Российские'], ['local', 'На своём компьютере и свой сервер']];
  const logoOf = p => { const [c, l] = LOGO[p.id] || p.logo || ['#5F6C86', p.title[0]]; return `<span class="cn-logo" style="background:${c}">${esc(l)}</span>`; };
  const statusOf = p => p.ready ? '<span class="pos">готов</span>' : !p.enabled && (p.hasKey && !p.noKey) ? 'выключен' : p.noKey ? (p.model ? 'выберите «Проверить»' : 'нужен запущенный сервер') : p.hasKey ? 'выберите модель' : 'ключ не задан';
  // раскрытая из «Добавить ИИ», но ещё пустая карточка: нет ключа, не включена (для локальных — модель не выбрана)
  const blank = p => expanded[p.id] && !p.enabled && !(p.hasKey && !p.noKey) && !(p.noKey && p.model);
  function aiCard(p) {
    const ml = (S.aiModelLists || {})[p.id];
    if (ml && ml.list && !models[p.id]) models[p.id] = ml.list;
    const keyRow = p.noKey ? '' : `<div class="cn-row">${keyInput('ai-key-' + p.id, p.hasKey && !p.noKey, (S.secrets.items[p.keyName] || {}).tail, (p.keyLabel || 'Ключ API') + (p.optionalKey ? ' (если сервер требует)' : ''))}
        <button class="bn" type="button" data-save="${p.id}">Сохранить</button></div>`;
    const fields = (p.fields || []).map(f => `<div class="cn-row"><label>${esc(f.label)}${f.options
      ? `<select data-field="${p.id}:${f.name}">${f.options.map(([v, t]) => `<option value="${esc(v)}" ${(f.value || f.options[0][0]) === v ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`
      : `<input data-field="${p.id}:${f.name}" type="text" value="${esc(f.value)}" placeholder="${esc(f.placeholder || '')}" spellcheck="false" autocomplete="off">`}</label></div>${f.hint ? `<p class="nt" style="margin:-4px 0 6px">${esc(f.hint)}</p>` : ''}`).join('');
    const canList = p.hasKey || p.noKey || p.optionalKey;
    return `<div class="cn-card" data-p="${p.id}">
      <div class="cn-head">${sw('ai-on-' + p.id, p.enabled, 'Использовать ' + p.title)}${logoOf(p)}
        <b>${esc(p.title)} <small>${esc(p.vendor)} · ${statusOf(p)}${p.stt ? ' · распознаёт голос' : ''}</small></b>${blank(p) ? `<button type="button" class="cn-x" data-drop="${p.id}" aria-label="Убрать ${esc(p.title)} — данные не заполнены" title="Убрать">` : `<button type="button" class="cn-x" data-remove="${p.id}" aria-label="Удалить ${esc(p.title)} из подключённых" title="Удалить">`}<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
      <div class="cn-body">${keyRow}${fields}
        <div class="cn-row"><label>Модель<select id="ai-model-${p.id}" ${!canList ? 'disabled' : ''}>${modelOptions(p)}</select></label>
          <button class="bn gh" type="button" data-test="${p.id}">${canList ? 'Проверить и обновить список' : 'Проверить'}</button></div>
        <p class="nt cn-mlist" id="ai-mlist-${p.id}">${listInfo(p, ml)}</p>
        <div class="cn-row" id="ai-custom-${p.id}" hidden><label>Название модели, как в API<input id="ai-cid-${p.id}" type="text" spellcheck="false" autocomplete="off" placeholder="${esc(((models[p.id] || [])[0] || {}).id || '')}"></label>
          <button class="bn" type="button" data-custom="${p.id}">Применить</button></div>
        <div class="cn-row cn-foot"><label class="cn-prim"><input type="radio" name="ai-primary" value="${p.id}" ${p.primary ? 'checked' : ''}>Основной — отвечает первым</label>
          ${p.keyUrl ? `<button class="cn-link" type="button" data-url="${esc(p.keyUrl)}">${p.noKey ? 'Скачать →' : 'Где взять ключ →'}</button>` : ''}</div>
        <p class="cn-msg" id="ai-msg-${p.id}" role="status"></p>
      </div></div>`;
  }
  function renderAI() {
    const el = sec('ai');
    const on = S.ai.filter(p => p.enabled || (p.hasKey && !p.noKey) || expanded[p.id]);
    const off = S.ai.filter(p => !on.includes(p));
    el.innerHTML = `<p class="nt" style="margin:10px 0 0">ИИ разбирает чеки и квитанции, отвечает помощнику и пишет выводы к листам. «Основной» отвечает первым, остальные включённые — запасные. Голос распознают Gemini, GPT и Groq.</p>
      <label class="cn-prim" style="margin:8px 0 4px"><input type="checkbox" role="switch" id="ai-insights" ${S.aiInsights ? 'checked' : ''}>Обновлять выводы ИИ на листах после обновления данных (не чаще раза в 4 часа)</label>
      ${on.map(aiCard).join('')}
      ${off.length ? `<h3 class="cn-h3">Добавить ИИ</h3>${GROUPS.map(([g, t]) => { const list = off.filter(p => (p.group || 'world') === g); return list.length ? `<p class="cn-gh">${t}</p><div class="cn-tiles">${list.map(p => `<button type="button" class="cn-tile" data-add="${p.id}">${logoOf(p)}<span><b>${esc(p.title)}</b><small>${esc(p.vendor)}</small></span></button>`).join('')}</div>` : ''; }).join('')}` : ''}`;

    // списки моделей подгружаются сами, если есть ключ, а списка нет или он старше суток
    for (const p of on) {
      const ml = (S.aiModelLists || {})[p.id];
      const stale = !ml || !ml.list || !ml.list.length || Date.now() - new Date(ml.at).getTime() > 864e5;
      if ((p.hasKey && !p.noKey) && stale && !loading[p.id] && !tried[p.id]) loadModels(p.id, false);
    }
    el.onchange = async e => {
      const t = e.target;
      if (t.dataset.field) {
        const [id, name] = t.dataset.field.split(':');
        S = await N.conn.setAi({ extra: { [id]: { [name]: t.value.trim() } } }); dirty();
        delete tried[id]; msg($('ai-msg-' + id), 'Сохранено.', 'ok');
        return;
      }
      if (t.id && t.id.startsWith('ai-model-') && t.value === '__custom') {
        const id = t.id.slice(9), row = $('ai-custom-' + id);
        t.value = (S.ai.find(p => p.id === id) || {}).model || '';
        row.hidden = false; $('ai-cid-' + id).focus();
        return;
      }
      if (t.id === 'ai-insights') { await N.insights.setAuto(t.checked); S.aiInsights = t.checked; return; }
      if (t.id && t.id.startsWith('ai-on-')) { const id = t.id.slice(6); S = await N.conn.setAi({ enabled: { [id]: t.checked } }); if (!t.checked) delete expanded[id]; dirty(); renderAI(); paintStatus(); }
      else if (t.id && t.id.startsWith('ai-model-')) { S = await N.conn.setAi({ models: { [t.id.slice(9)]: t.value } }); dirty(); renderAI(); paintStatus(); }
      else if (t.name === 'ai-primary') { S = await N.conn.setAi({ primary: t.value, enabled: { [t.value]: true } }); dirty(); renderAI(); }
    };
    // удаление пустой карточки: схлопывается (прозрачность, масштаб, высота), затем плитка возвращается в «Добавить ИИ»
    const drop = id => {
      const card = el.querySelector(`.cn-card[data-p="${id}"]`);
      const done = () => { delete expanded[id]; renderAI(); const t = el.querySelector(`.cn-tile[data-add="${id}"]`); if (t) { t.classList.add('cn-back'); t.focus({ preventScroll: true }); } };
      if (!card || matchMedia('(prefers-reduced-motion: reduce)').matches) return done();
      card.style.height = card.offsetHeight + 'px'; void card.offsetHeight;
      card.classList.add('cn-gone');
      let fin = false; const end = () => { if (!fin) { fin = true; done(); } };
      card.addEventListener('transitionend', e => { if (e.target === card && e.propertyName === 'height') end(); });
      setTimeout(end, 420);
    };
    el.onclick = async e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.url) return N.app.openUrl(b.dataset.url);
      if (b.dataset.drop) return drop(b.dataset.drop);
      if (b.dataset.remove) {
        const id = b.dataset.remove, p = S.ai.find(x => x.id === id) || {};
        const ask = (window.FD_PAGE && window.FD_PAGE.askConfirm) || (t => Promise.resolve(confirm(t)));
        if (!(await ask(`Удалить ${p.title || id} из подключённых? ${p.hasKey && !p.noKey ? 'Ключ будет стёрт из secrets.json, ' : ''}выбранная модель и настройки забудутся. Подключить снова можно плиткой «Добавить ИИ».`))) return;
        if (p.keyName && p.hasKey && !p.noKey) await N.conn.setSecret(p.keyName, '');
        S = await N.conn.setAi({ remove: id });
        delete models[id]; delete tried[id];
        dirty(); paintStatus();
        return drop(id);
      }
      if (b.dataset.add) {
        const id = b.dataset.add; expanded[id] = true; renderAI();
        const card = el.querySelector(`.cn-card[data-p="${id}"]`);
        if (card) { card.classList.add('cn-new'); card.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); const f = card.querySelector('input:not([type=checkbox]):not([type=radio]),select'); if (f) f.focus(); }
        return;
      }
      if (b.dataset.custom) {
        const id = b.dataset.custom, v = $('ai-cid-' + id).value.trim();
        if (!v) return msg($('ai-msg-' + id), 'Впишите название модели.', 'err');
        S = await N.conn.setAi({ models: { [id]: v }, enabled: { [id]: true } }); dirty(); renderAI(); paintStatus();
        msg($('ai-msg-' + id), `Модель ${v} выбрана. Нажмите «Проверить», чтобы убедиться, что ключ к ней подходит.`, 'ok');
        return;
      }
      const id = b.dataset.save || b.dataset.test; if (!id) return;
      const p = S.ai.find(x => x.id === id) || {};
      const m = $('ai-msg-' + id);
      // доп. поля карточки (каталог, адрес) — сохраняем перед проверкой, даже если не было change
      for (const f of el.querySelectorAll(`[data-field^="${id}:"]`)) await N.conn.setAi({ extra: { [id]: { [f.dataset.field.split(':')[1]]: f.value.trim() } } });
      if (b.dataset.save) {
        const v = $('ai-key-' + id).value.trim();
        if (!v) return msg(m, 'Вставьте ключ в поле выше.', 'err');
        S = await N.conn.setSecret(p.keyName, v);
        await N.conn.setAi({ enabled: { [id]: true } });
        dirty();
      }
      const r = await act(m, () => N.conn.test(id), x => `Подключено. Моделей: ${x.models.length}.`);
      if (r) { models[id] = r.models; await N.conn.setAi({ enabled: { [id]: true } }); }
      S = await N.conn.status();
      const keep = m ? m.textContent : '', cls = m ? m.className : '';
      renderAI(); paintStatus();
      const m2 = $('ai-msg-' + id); if (m2) { m2.textContent = keep; m2.className = cls; }
    };
  }

  /* ---------- Zenmoney ---------- */
  function renderZen() {
    const z = S.zenmoney;
    sec('zen').innerHTML = `<div class="cn-card">
      <div class="cn-head">${sw('zen-on', z.enabled, 'Использовать Zenmoney')}<span class="cn-logo" style="background:#F2B200;color:#1b1b1b">Z</span>
        <b>Zenmoney <small>${z.hasToken ? 'токен сохранён (…' + esc(z.tail) + ')' : 'токен не задан'} · последняя синхронизация: ${z.lastSync ? esc(new Date(z.lastSync).toLocaleString('ru-RU')) : 'ещё не было'}</small></b></div>
      <ol class="cn-steps">
        <li>Откройте <button class="cn-link" type="button" data-url="https://zerro.app/token">zerro.app/token</button> и войдите своим логином Zenmoney.</li>
        <li>Скопируйте показанный токен и вставьте ниже. Токен даёт полный доступ к вашему Zenmoney — храните его как пароль; программа только читает данные.</li>
        <li>Нажмите «Сохранить и подключить» — загрузится вся история операций.</li></ol>
      <div class="cn-row">${keyInput('zen-token', z.hasToken, z.tail, 'Токен доступа')}<button class="bn" type="button" id="zen-save">Сохранить и подключить</button></div>
      ${z.hasToken ? `<div class="cn-row"><button class="bn gh" type="button" id="zen-sync">Обновить сейчас</button><button class="bn gh" type="button" id="zen-full">Загрузить всю историю заново</button></div>` : ''}
      <p class="cn-msg" id="zen-msg"></p></div>`;
    const keepMsg = () => { const m = $('zen-msg'); return [m.textContent, m.className]; };
    const putMsg = ([t, c]) => { const m = $('zen-msg'); if (m) { m.textContent = t; m.className = c; } };
    async function syncNow(full) {
      const m = $('zen-msg');
      msg(m, full ? 'Загружаю всю историю из Zenmoney… Это может занять до минуты.' : 'Загружаю изменения из Zenmoney…');
      try {
        const st = await N.digest.refresh({ full });
        const r = st.lastRun || {};
        msg(m, `Готово: ${r.full ? 'загружена история' : 'изменений ' + ((r.changed || 0) + (r.deleted || 0))}, операций в базе: ${r.total ?? '—'}. Перезагружаю отчёт…`, 'ok');
        setTimeout(() => location.reload(), 1200);
      } catch (e) { msg(m, 'Ошибка: ' + errText(e), 'err'); }
    }
    sec('zen').onclick = async e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.url) return N.app.openUrl(b.dataset.url);
      if (b.id === 'zen-sync') return syncNow(false);
      if (b.id === 'zen-full') return syncNow(true);
      if (b.id === 'zen-save') {
        const v = $('zen-token').value.trim(), m = $('zen-msg');
        if (v) { S = await N.conn.setSecret('zenmoney_token', v); S = await N.conn.setZen({ enabled: true }); }
        const r = await act(m, () => N.conn.test('zenmoney'), x => 'Подключено' + (x.login ? ': ' + x.login : '') + '.');
        const kept = keepMsg();
        S = await N.conn.status(); renderZen(); paintStatus(); putMsg(kept);
        if (r) await syncNow(!S.zenmoney.lastSync);
        return r;
      }
    };
    sec('zen').onchange = async e => { if (e.target.id === 'zen-on') { S = await N.conn.setZen({ enabled: e.target.checked }); paintStatus(); } };
  }

  /* ---------- Обновление: расписание, трей, автозапуск ---------- */
  async function renderUpd() {
    let st;
    try { st = await N.digest.status(); } catch (_) { return; }
    const sc = st.schedule || {}, ap = st.app || {};
    const next = sc.next ? new Date(sc.next).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
    const opt = (v, t, cur) => `<option value="${v}" ${String(v) === String(cur) ? 'selected' : ''}>${t}</option>`;
    sec('upd').innerHTML = `<div class="cn-card"><b>Обновление данных Zenmoney</b>
      <p class="nt" style="margin:4px 0 0">Программа забирает изменения и пересчитывает листы. Работает, пока программа открыта или свёрнута в трей.</p>
      <div class="cn-row"><label>Когда обновлять<select id="up-mode">${opt('times', 'В заданное время каждый день', sc.mode)}${opt('interval', 'Через каждые N часов', sc.mode)}${opt('off', 'Только вручную', sc.mode)}</select></label></div>
      <div class="cn-row" ${sc.mode === 'times' ? '' : 'style="display:none"'}><label>Время (через запятую)<input id="up-times" value="${esc((sc.times || []).join(', '))}" placeholder="08:00, 20:00"></label></div>
      <div class="cn-row" ${sc.mode === 'interval' ? '' : 'style="display:none"'}><label>Каждые<select id="up-every">${[1, 2, 3, 6, 12, 24].map(h => opt(h, h + ' ч', sc.everyHours)).join('')}</select></label></div>
      <div class="cn-row" style="flex-direction:column;align-items:flex-start;gap:2px">
        <label class="cn-prim"><input type="checkbox" role="switch" id="up-start" ${sc.onStart ? 'checked' : ''}>Обновлять при запуске программы</label>
        <label class="cn-prim"><input type="checkbox" role="switch" id="up-tray" ${ap.tray ? 'checked' : ''}>При закрытии окна сворачивать в трей (расписание продолжит работать)</label>
        <label class="cn-prim"><input type="checkbox" role="switch" id="up-auto" ${ap.autostart ? 'checked' : ''}>Запускать вместе с Windows (в трее)</label></div>
      <div class="cn-kv"><span>Последнее обновление</span><span>${esc(st.lastSyncText || 'ещё не было')}${st.lastError ? ' · <span class="neg">' + esc(st.lastError.message) + '</span>' : ''}</span>
        <span>Следующее</span><span>${sc.mode === 'off' ? 'вручную' : esc(next)}</span></div>
      <div class="cn-row"><button class="bn" type="button" id="up-save">Сохранить</button><button class="bn gh" type="button" id="up-now">Обновить сейчас</button></div>
      <p class="cn-msg" id="up-msg"></p></div>`;
    const el = sec('upd');
    el.onchange = e => { if (e.target.id === 'up-mode') { el.querySelectorAll('.cn-row')[1].style.display = e.target.value === 'times' ? '' : 'none'; el.querySelectorAll('.cn-row')[2].style.display = e.target.value === 'interval' ? '' : 'none'; } };
    el.onclick = async e => {
      const b = e.target.closest('button'); if (!b) return;
      const m = $('up-msg');
      if (b.id === 'up-save') {
        const times = $('up-times').value.split(/[,;\s]+/).filter(Boolean);
        const bad = times.filter(t => !/^\d{1,2}:\d{2}$/.test(t));
        if (bad.length) return msg(m, 'Время пишите как 08:00 или 20:30. Не понял: ' + bad.join(', '), 'err');
        await N.digest.setSchedule({ mode: $('up-mode').value, times, everyHours: +$('up-every').value, onStart: $('up-start').checked });
        await N.digest.setPrefs({ tray: $('up-tray').checked, autostart: $('up-auto').checked });
        await renderUpd(); msg($('up-msg'), 'Сохранено.', 'ok');
      }
      if (b.id === 'up-now') {
        msg(m, 'Обновляю…');
        try { await N.digest.refresh(); msg(m, 'Готово. Перезагружаю отчёт…', 'ok'); setTimeout(() => location.reload(), 900); }
        catch (x) { msg(m, 'Ошибка: ' + errText(x), 'err'); }
      }
    };
  }

  /* ---------- Почта ---------- */
  function renderMail() {
    const m = S.mail, pr = m.presets[m.provider] || m.presets.custom;
    const snd = Object.entries(m.senders || {});
    sec('mail').innerHTML = `<div class="cn-card">
      <div class="cn-head">${sw('mail-on', m.enabled, 'Использовать почту')}<span class="cn-logo" style="background:#168DE2">@</span>
        <b>Почта с чеками <small>${m.user ? esc(m.user) : 'не настроена'}${m.hasPassword ? ' · пароль сохранён' : ''}</small></b></div>
      <p class="nt" style="margin:8px 0 0">Магазины присылают электронные чеки на почту. Программа сама находит такие письма по адресам отправителей, разбирает чеки и добавляет покупки в «Продукты» — нажимать ничего не нужно.</p>
      <div class="cn-row"><label>Почтовый сервис<select id="mail-prov">${Object.entries(m.presets).map(([k, v]) => `<option value="${k}" ${k === m.provider ? 'selected' : ''}>${esc(v.title)}</option>`).join('')}</select></label></div>
      <div class="cn-row" ${m.provider === 'custom' ? '' : 'style="display:none"'}><label>Сервер IMAP<input id="mail-host" value="${esc(m.host)}"></label><label style="flex:0 1 110px">Порт<input id="mail-port" type="number" value="${esc(m.port)}"></label></div>
      <div class="cn-row"><label>Адрес почты<input id="mail-user" type="email" value="${esc(m.user)}" placeholder="name@mail.ru"></label></div>
      <div class="cn-row">${keyInput('mail-pass', m.hasPassword, '', 'Пароль для внешних приложений')}</div>
      ${pr.passUrl ? `<p class="nt" style="margin:6px 0 0">Обычный пароль от почты не подойдёт: нужен отдельный «пароль для внешних приложений». <button class="cn-link" type="button" data-url="${esc(pr.passUrl)}">Создать его →</button></p>` : ''}
      <h3>Адреса отправителей чеков</h3>
      <div id="mail-snd">${snd.map(([k, v]) => sndRow(k, v)).join('')}</div>
      <button class="bn gh" type="button" id="mail-add" style="min-height:38px;margin-top:4px">+ Магазин</button>
      <p class="nt" style="margin:6px 0 0">Можно указать часть адреса: «ofd» найдёт чеки любого оператора фискальных данных.</p>
      <h3>Как поступают чеки</h3>
      <ol class="cn-flow">
        <li><b>Письмо пришло</b><span>программа проверяет почту при запуске, ${+m.pollMinutes ? 'каждые ' + (+m.pollMinutes === 60 ? 'час' : m.pollMinutes + ' мин') : 'по расписанию обновления'} и по кнопке «Обновить» в шапке</span></li>
        <li><b>Чек в архиве</b><span>оригинал сохраняется в базе — «Продукты → Архив чеков»</span></li>
        <li><b>Покупки в отчёте</b><span>${m.autoParse ? 'чек сразу разбирается: текстовые — сами, фото и PDF-сканы — ИИ' : 'разбор — по кнопке в подсказке (автоматический разбор выключен)'}; появляется подсказка «Новый чек: магазин · сумма»</span></li>
      </ol>
      <div class="cn-row"><label>Проверять почту<select id="mail-poll">${[[15, 'каждые 15 минут'], [30, 'каждые 30 минут'], [60, 'каждый час'], [0, 'только при обновлении данных']].map(([v, t]) => `<option value="${v}" ${+(m.pollMinutes ?? 30) === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label>Новый магазин — искать письма за<select id="mail-depth">${[30, 90, 180, 365].map(d => `<option value="${d}" ${+m.depthDays === d ? 'selected' : ''}>${d} дней</option>`).join('')}</select></label></div>
      <div class="cn-row" style="flex-direction:column;align-items:flex-start;gap:2px">
        <label class="cn-prim"><input type="checkbox" role="switch" id="mail-auto" ${m.autoParse ? 'checked' : ''}>Сразу разбирать новые чеки и добавлять покупки в «Продукты»</label>
        <label class="cn-prim"><input type="checkbox" role="switch" id="mail-subj" ${m.subjectSearch ? 'checked' : ''}>Искать и по теме письма («кассовый чек», «электронный чек»)</label></div>
      ${m.lastCheck ? `<div class="cn-kv"><span>Последняя проверка</span><span>${esc(new Date(m.lastCheck).toLocaleString('ru-RU'))}</span>${m.lastResult ? `<span>Результат</span><span>новых писем ${m.lastResult.checked}, чеков ${m.lastResult.receipts}${m.lastResult.skipped ? ', без чека ' + m.lastResult.skipped : ''}${m.lastResult.errors ? ', ошибок ' + m.lastResult.errors : ''}</span>` : ''}</div>` : ''}
      <div class="cn-row"><button class="bn" type="button" id="mail-save">Сохранить и проверить почту</button></div>
      <p class="cn-msg" id="mail-msg"></p></div>`;
    const el = sec('mail');
    el.onclick = async e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.url) return N.app.openUrl(b.dataset.url);
      if (b.dataset.rm != null) { b.closest('.cn-snd').remove(); return; }
      if (b.id === 'mail-add') { $('mail-snd').insertAdjacentHTML('beforeend', sndRow('', '')); return; }
      if (b.id === 'mail-save') {
        const senders = {};
        el.querySelectorAll('.cn-snd').forEach(r => { const [a, c] = r.querySelectorAll('input'); if (a.value.trim() && c.value.trim()) senders[a.value.trim()] = c.value.trim(); });
        const prov = $('mail-prov').value, pset = S.mail.presets[prov];
        const patch = { provider: prov, user: $('mail-user').value.trim(), senders, enabled: true,
          subjectSearch: $('mail-subj').checked, autoParse: $('mail-auto').checked, depthDays: +$('mail-depth').value, pollMinutes: +$('mail-poll').value,
          host: prov === 'custom' ? $('mail-host').value.trim() : pset.host, port: prov === 'custom' ? +$('mail-port').value || 993 : pset.port };
        S = await N.conn.setMail(patch);
        const p = $('mail-pass').value; if (p) S = await N.conn.setSecret('mail_password', p);
        const mm = $('mail-msg');
        // одна кнопка на весь путь: вход → чеки в архив (письма без чека и удалённые из архива — перечитать) → разбор → «Продукты»
        const t0 = await act(mm, () => N.conn.test('mail'), x => `Подключено. Писем от ваших магазинов за 90 дней: ${x.receipts90d}. Загружаю и разбираю…`);
        if (!t0) return;
        const dm = d => (d ? new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) : '');
        const who = l => `${l.shop || l.from || 'письмо'}${l.date ? ' ' + dm(l.date) : ''}${l.subject ? ` («${l.subject.slice(0, 40)}»)` : ''}`;
        const lines = [`Подключено. Писем от ваших магазинов за 90 дней: ${t0.receipts90d}.`];
        try {
          const st = await N.digest.refresh({ only: 'mail', retry: true });
          const lr = st.lastRun || {}, mr = lr.mail || {}, ids = mr.ids || [];
          const err = (lr.errors || []).find(x => x.source === 'mail');
          if (err) throw Object.assign(new Error(err.message), { code: err.code });
          if (ids.length) {
            msg(mm, lines[0] + ` Найдено чеков: ${ids.length}, разбираю…`);
            const list = window.FD_mailIngest ? await window.FD_mailIngest(ids, { quietIfNone: true }) : [];
            const ok = list.filter(x => x.status === 'parsed'), bad = list.filter(x => x.status !== 'parsed');
            if (ok.length) lines.push(`В «Продукты» добавлено чеков: ${ok.length} (${[...new Set(ok.map(x => x.store || 'магазин'))].join(', ')}).`);
            if (bad.length) lines.push(`В архиве, но не разобрано: ${bad.length}${bad[0].err ? ' — ' + bad[0].err : ''}.`);
          }
          // письма, из которых чек не получился, — с причиной
          for (const l of (mr.letters || []).filter(x => x.status !== 'imported').slice(0, 4)) lines.push(`${who(l)}: ${l.note || 'чек не найден'}.`);
          // письма, которые уже были в архиве раньше
          const before = (t0.letters || []).filter(l => l.status === 'imported').length;
          if (!ids.length && !(mr.letters || []).length) lines.push(before ? `Новых нет — найденные письма уже в архиве чеков (${before}).` : 'Новых писем с чеками нет.');
          S = await N.conn.status(); renderMail(); paintStatus();
          msg($('mail-msg'), lines.join(' '), (mr.letters || []).some(l => l.status !== 'imported') && !ids.length ? 'err' : 'ok');
        } catch (x) { S = await N.conn.status(); renderMail(); paintStatus(); msg($('mail-msg'), lines.join(' ') + ' Загрузка не удалась: ' + errText(x), 'err'); }
      }
    };
    el.onchange = async e => {
      if (e.target.id === 'mail-on') { S = await N.conn.setMail({ enabled: e.target.checked }); paintStatus(); }
      if (e.target.id === 'mail-poll') { S = await N.conn.setMail({ pollMinutes: +e.target.value }); }
      if (e.target.id === 'mail-auto') { S = await N.conn.setMail({ autoParse: e.target.checked }); }
      if (e.target.id === 'mail-prov') { const v = e.target.value, p = S.mail.presets[v]; S = await N.conn.setMail({ provider: v, host: p.host || S.mail.host, port: p.port }); renderMail(); }
    };
  }
  const sndRow = (k, v) => `<div class="cn-snd"><input value="${esc(k)}" placeholder="Магазин" aria-label="Магазин"><input type="text" value="${esc(v)}" placeholder="адрес отправителя чеков" aria-label="Адрес отправителя" spellcheck="false"><button type="button" data-rm aria-label="Удалить">×</button></div>`;

  /* ---------- Сеть и данные ---------- */
  function renderSys() {
    const d = S.db, sc = S.secrets;
    sec('sys').innerHTML = `<div class="cn-card"><b>Прокси для ИИ-сервисов</b>
      <p class="nt" style="margin:4px 0 0">Claude, GPT и Gemini могут не открываться из России напрямую. Если у вас есть VPN — достаточно включить его. Если прокси — укажите его адрес. Пусто = как настроено в Windows.</p>
      <div class="cn-row"><label>Адрес прокси<input id="sys-proxy" value="${esc(S.network.proxy)}" placeholder="http://127.0.0.1:8080 или socks5://127.0.0.1:1080"></label><button class="bn" type="button" id="sys-psave">Сохранить</button></div>
      <p class="cn-msg" id="sys-pmsg"></p></div>
    <div class="cn-card"><b>Логотипы банков и магазинов</b>
      <p class="nt" style="margin:4px 0 0">Значки загружаются с сайтов банков и магазинов (или через сервис значков Google) и хранятся в базе 30 дней. Отправляется только адрес сайта — никаких ваших данных.</p>
      <label class="cn-prim" style="margin-top:6px"><input type="checkbox" role="switch" id="sys-logos" ${S.network.logos !== false ? 'checked' : ''}>Загружать логотипы из интернета</label></div>
    <div class="cn-card"><b>Где хранятся данные</b>
      <div class="cn-kv"><span>База чеков и квитанций</span><code>${esc(d.file)}</code>
        <span>Размер / схема</span><span>${d.sizeKb} КБ · версия ${d.schema}</span>
        <span>В архиве</span><span>чеков: ${d.receipts} (${d.receiptItems} поз.), квитанций: ${d.bills} (${d.billItems} строк)</span>
        <span>Ключи и пароли</span><code>${esc(sc.file)}</code>
        <span>Шифрование</span><span>${sc.encrypted ? '<span class="pos">включено (Windows)</span>' : '<span class="neg">недоступно — ключи хранятся открыто</span>'}</span></div>
      <div class="cn-row"><button class="bn gh" type="button" data-open="data">Папка базы</button><button class="bn gh" type="button" data-open="config">Папка настроек</button><button class="bn gh" type="button" data-open="archive">Оригиналы чеков</button><button class="bn gh" type="button" data-open="logs">Журнал</button></div></div>`;
    sec('sys').onchange = async e => {
      if (e.target.id === 'sys-logos') { S = await N.conn.setLogos(e.target.checked); dirty(); }
    };
    sec('sys').onclick = async e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.open) return N.app.open(b.dataset.open);
      if (b.id === 'sys-psave') { S = await N.conn.setProxy($('sys-proxy').value); msg($('sys-pmsg'), 'Сохранено. Проверьте ИИ кнопкой «Проверить».', 'ok'); dirty(); }
    };
  }

  /* ---------- модели ИИ: выпадающий список из API ---------- */
  const loading = {}, tried = {};
  function modelOptions(p) {
    const list = models[p.id] || [], cur = p.model;
    const chat = list.filter(m => m.chat !== false), other = list.filter(m => m.chat === false);
    const opt = m => `<option value="${esc(m.id)}" ${m.id === cur ? 'selected' : ''}>${esc(m.name)}${m.name !== m.id ? ' · ' + esc(m.id) : ''}</option>`;
    let h = '';
    if (cur && !list.some(m => m.id === cur)) h += `<option value="${esc(cur)}" selected>${esc(cur)}${list.length ? ' — нет в списке API' : ''}</option>`;
    if (!list.length && !cur) h += `<option value="">${loading[p.id] ? 'Загружаю список моделей…' : p.hasKey ? 'Список не загружен' : 'Сначала сохраните ключ'}</option>`;
    if (chat.length) h += `<optgroup label="Для отчёта и помощника · ${chat.length}">${chat.map(opt).join('')}</optgroup>`;
    if (other.length) h += `<optgroup label="Другие модели API · ${other.length} — для текста могут не подойти">${other.map(opt).join('')}</optgroup>`;
    if (p.hasKey) h += '<option value="__custom">Ввести название вручную…</option>';
    return h;
  }
  const when = iso => { const d = new Date(iso), z = n => String(n).padStart(2, '0'); return `${z(d.getDate())}.${z(d.getMonth() + 1)}, ${z(d.getHours())}:${z(d.getMinutes())}`; };
  function listInfo(p, ml) {
    if (!p.hasKey) return 'Список моделей загрузится из API после сохранения ключа.';
    if (loading[p.id]) return 'Загружаю список моделей из API…';
    if (ml && ml.list && ml.list.length) return `Моделей в API: ${ml.list.length}, для текста — ${ml.list.filter(m => m.chat !== false).length} · список от ${when(ml.at)}`;
    return tried[p.id] ? 'Список не загрузился — нажмите «Проверить и обновить список».' : '';
  }
  async function loadModels(id, refresh) {
    loading[id] = true; tried[id] = true;
    const info = $('ai-mlist-' + id); if (info) info.textContent = 'Загружаю список моделей из API…';
    try { const r = await N.conn.models(id, refresh); models[id] = r.list; }
    catch (e) { loading[id] = false; const m = $('ai-msg-' + id); msg(m, 'Список моделей не загрузился: ' + errText(e), 'err'); const i2 = $('ai-mlist-' + id); if (i2) i2.textContent = listInfo((S.ai.find(p => p.id === id) || {}), null); return; }
    loading[id] = false;
    S = await N.conn.status();
    if (!panel.hidden) { renderAI(); paintStatus(); }
  }

  /* ---------- статусы ---------- */
  function paintStatus() {
    if (!S) return;
    const aiOk = S.ai.some(p => p.ready), aiAny = S.ai.some(p => p.enabled || p.hasKey);
    const zOk = S.zenmoney.enabled && S.zenmoney.hasToken, mOk = S.mail.enabled && S.mail.user && S.mail.hasPassword;
    const set = (id, c) => { const el = $(id); if (el) el.className = c; };
    set('ct-ai', aiOk ? 'ok' : aiAny ? 'warn' : '');
    set('ct-zen', zOk ? 'ok' : S.zenmoney.hasToken ? 'warn' : '');
    set('ct-mail', mOk ? 'ok' : S.mail.user ? 'warn' : '');
    set('ct-upd', zOk ? 'ok' : '');
    const d = $('cnd'); if (d) d.className = 'cn-dot ' + (aiOk && zOk ? 'ok' : aiOk || zOk || mOk ? 'warn' : '');
  }

  async function refresh() {
    try { S = await N.conn.status(); } catch (e) { return; }
    renderAI(); renderZen(); renderMail(); renderSys(); renderUpd(); paintTabs(); paintStatus();
    $('cnap').hidden = !aiDirty;
  }

  N.conn.status().then(s => { S = s; paintStatus(); }).catch(() => {});
  window.FD_openConnections = which => open(true, which);
})();
