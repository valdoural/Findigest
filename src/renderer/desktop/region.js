/**
 * «Вы, регион и РФ» (лист «Доходы и расходы»): выбор субъекта РФ и подстановка ориентиров, найденных ИИ
 * (main/insights/region.js). Пустые значения — «нет данных». После смены данных перерисовывается и
 * «Где вы по доходам среди населения» (window.FD_REGION читает страница).
 */
(function () {
  'use strict';
  const N = window.fdNative; const $ = id => document.getElementById(id);
  const sel = $('rg-sel'); if (!N || !N.region || !sel) return;
  const nf = (v, d = 0) => (+v).toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d });
  const short = n => n.replace(/^Республика\s+/, 'Респ. ').replace(/\s+Республика$/, ' Респ.').replace(/\s+область$/, ' обл.').replace(/\s+край$/, ' кр.')
    .replace(/автономный округ/, 'АО').replace(/автономная область/, 'АО').replace(/Народная Республика/, 'НР').replace(/\s+—.*$/, '').replace(/^Свердловская обл\.$/, 'Свердл. обл.');
  const fmt = (k, x) => {
    if (!x) return '<span class="nt">нет данных</span>';
    const val = k === 'salary' || k === 'median' ? nf(x.v / 1000, 1).replace(/,0$/, '') + ' тыс.' : (k === 'savings' ? nf(x.v, 1).replace(/,0$/, '') + '%' : nf(x.v, 1).replace(/,0$/, ''));
    return val + (x.p ? ` <span class="nt">(${x.p})</span>` : '') + (x.note ? `<br><span class="nt">${x.note}</span>` : '');
  };
  let S = null, busy = false;
  function paint(st) {
    S = st;
    if (sel.options.length !== st.regions.length) sel.innerHTML = st.regions.map(r => `<option>${r}</option>`).join('');
    sel.value = st.name;
    const reg = st.region || {}, rf = st.rf || {};
    $('rg-th').textContent = short(st.name);
    for (const k of ['salary', 'savings', 'food', 'cafe', 'alcohol']) {
      $('rg-' + k).innerHTML = fmt(k, reg[k]);
      $('rf-' + k).innerHTML = k === 'salary' && rf.median ? fmt(k, rf.salary) + `<br><span class="nt">медиана ≈ ${nf(rf.median.v / 1000)} тыс.</span>` : fmt(k, rf[k]);
    }
    const src = [reg.src && `${short(st.name)}: ${reg.src}`, rf.src && `РФ: ${rf.src}`].filter(Boolean).join('; ');
    const who = (reg.provider || rf.provider) ? ` Найдено ИИ (${reg.provider || rf.provider}) ${reg.at ? new Date(reg.at).toLocaleDateString('ru-RU') : ''} — сверяйте с источником.` : '';
    const state = st.running ? ' Ищу данные…' : st.error ? ` Не удалось найти: ${st.error}.` : '';
    $('rg-note').textContent = `Колонка «Вы» — ваши данные за три последних закрытых месяца. ${src ? 'Источники: ' + src + '.' : ''}${who}${state}`.trim();
    const b = $('rg-ref'); b.disabled = !!st.running || !st.available; b.textContent = st.running ? 'Ищу…' : 'Найти данные';
    b.title = st.available ? 'ИИ найдёт свежие официальные цифры (Росстат) для выбранного субъекта и РФ' : 'Подключите ИИ в «Подключениях»';
    const prev = JSON.stringify(window.FD_REGION || {});
    window.FD_REGION = { name: st.name, short: short(st.name), salary: reg.salary && reg.salary.v, rfMean: rf.salary && rf.salary.v, rfMedian: rf.median && rf.median.v };
    if (prev !== JSON.stringify(window.FD_REGION) && !busy) { busy = true; const tn = $('tn'); if (tn) tn.dispatchEvent(new Event('input', { bubbles: true })); busy = false; } // перерисует «Где вы по доходам»
  }
  sel.addEventListener('change', async () => paint(await N.region.set(sel.value)));
  $('rg-ref').addEventListener('click', async () => { paint({ ...S, running: true }); paint(await N.region.refresh()); });
  N.region.onUpdated(paint);
  N.region.get().then(paint).catch(() => {});
})();
