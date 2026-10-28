/**
 * Голосовой помощник: кнопка с микрофоном в шапке и панель диалога.
 *   Голос: запись в WAV (16 кГц, моно) с автоостановкой по тишине → расшифровка Gemini/GPT → вопрос помощнику.
 *   Ответ: на экране (с перечнем) и вслух — системным голосом Windows или голосом OpenAI.
 *   Горячая клавиша (по умолчанию Ctrl+Shift+Пробел) работает и из трея — окно откроется и начнёт слушать.
 */
(function () {
  'use strict';
  const N = window.fdNative;
  if (!N || !N.assistant) return;
  const A = N.assistant;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const MIC = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/></svg>';
  const SEND = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>';
  const GEAR = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';
  const CHIPS = ['Сколько я потратил в этом месяце?', 'Сравни расходы с прошлым месяцем', 'На что уходит больше всего?', 'Сколько осталось до моих целей?', 'Сколько я трачу на продукты в Пятёрочке?', 'Какой остаток на счетах?'];

  let info = { ai: false, stt: null, tts: false, settings: {} };
  const history = []; // {q, a} для контекста следующих вопросов

  /* ---------- кнопка в шапке ---------- */
  const btn = document.createElement('button');
  btn.className = 'ib'; btn.id = 'asb'; btn.type = 'button';
  btn.setAttribute('aria-controls', 'asp'); btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-label', 'Помощник: спросите голосом или текстом'); btn.dataset.tip = 'Помощник · Ctrl+Shift+Пробел';
  btn.innerHTML = MIC;
  const acts = document.querySelector('.fd-actions');
  if (acts) acts.insertBefore(btn, acts.firstChild); else (document.querySelector('.top .in') || document.body).appendChild(btn);
  if (window.FD_relayout) window.FD_relayout(); // шапка пересчитает режим с учётом новой кнопки

  /* ---------- панель ---------- */
  const panel = document.createElement('section');
  panel.id = 'asp'; panel.hidden = true; panel.setAttribute('aria-label', 'Помощник');
  panel.innerHTML = `
    <div class="as-head"><div style="flex:1;min-width:0"><h2>Помощник</h2><small id="as-st">…</small></div>
      <button class="nb" id="as-gear" type="button" aria-label="Настройки голоса" aria-expanded="false">${GEAR}</button>
      <button class="nb" id="as-x" type="button" aria-label="Закрыть">×</button></div>
    <div class="as-log" id="as-log" role="log" aria-live="polite"></div>
    <div class="as-chips" id="as-chips"></div>
    <div class="as-speaking" id="as-spk"><span>Говорю ответ…</span><button type="button" id="as-stop">Остановить</button></div>
    <div class="as-rec" id="as-rec" role="status"><span id="as-rect">Слушаю…</span><div class="as-lvl"><i id="as-lvl"></i></div><button class="bn gh" type="button" id="as-cancel" style="min-height:36px">Отмена</button></div>
    <div class="as-set" id="as-set" hidden></div>
    <form class="as-form" id="as-form">
      <textarea id="as-in" rows="1" placeholder="Спросите о своих деньгах…" aria-label="Вопрос помощнику"></textarea>
      <button class="ib mic" id="as-mic" type="button" aria-label="Сказать голосом">${MIC}</button>
      <button class="ib" id="as-send" type="submit" aria-label="Отправить">${SEND}</button>
    </form>`;
  document.body.appendChild(panel);

  function open(on, opts = {}) {
    panel.hidden = !on; btn.setAttribute('aria-expanded', String(on));
    if (!on) { stopRec(true); return; }
    refreshInfo();
    if (opts.listen) startRec(); else setTimeout(() => $('as-in').focus(), 30);
  }
  btn.onclick = () => open(panel.hidden);
  window.FD_closeAssistant = () => open(false);
  $('as-x').onclick = () => open(false);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !panel.hidden) { if (rec) stopRec(true); else open(false); }
    if (e.code === 'Space' && e.ctrlKey && e.shiftKey) { e.preventDefault(); if (panel.hidden) open(true, { listen: true }); else if (rec) stopRec(); else startRec(); }
  });
  A.onListen(() => { if (panel.hidden) open(true, { listen: true }); else if (!rec) startRec(); });

  /* ---------- сообщения ---------- */
  function md(t) { // безопасная разметка: **жирный**, списки «- », абзацы
    const lines = esc(t).split('\n');
    let html = '', list = false;
    for (const l of lines) {
      const li = /^\s*[-•]\s+(.*)/.exec(l);
      if (li) { if (!list) { html += '<ul>'; list = true; } html += '<li>' + li[1] + '</li>'; continue; }
      if (list) { html += '</ul>'; list = false; }
      if (l.trim()) html += '<p>' + l + '</p>';
    }
    if (list) html += '</ul>';
    return html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  }
  function add(role, text, meta) {
    const d = document.createElement('div');
    d.className = 'as-msg ' + role;
    if (role === 'u') d.textContent = text; else d.innerHTML = md(text);
    if (meta) d.appendChild(meta);
    $('as-log').appendChild(d);
    $('as-log').scrollTop = $('as-log').scrollHeight;
    $('as-chips').hidden = true;
    return d;
  }
  function typing() { const d = document.createElement('div'); d.className = 'as-msg a'; d.innerHTML = '<span class="as-typing" aria-label="Думаю"><i></i><i></i><i></i></span>'; $('as-log').appendChild(d); $('as-log').scrollTop = 1e9; return d; }

  $('as-chips').innerHTML = CHIPS.map(c => `<button type="button">${esc(c)}</button>`).join('');
  $('as-chips').onclick = e => { const b = e.target.closest('button'); if (b) send(b.textContent, false); };

  let busy = false;
  async function send(text, voice) {
    const q = String(text || '').trim(); if (!q || busy) return;
    if (!info.ai) { add('a', 'ИИ не подключён. Откройте «Подключения» и добавьте ключ Claude, Gemini или GPT — тогда я смогу отвечать по вашим данным.'); return; }
    busy = true; $('as-in').value = ''; autosize();
    add('u', q);
    const t = typing();
    try {
      const r = await A.ask({ question: q, voice, history: history.slice(-4) });
      t.remove();
      const meta = document.createElement('div'); meta.className = 'as-meta';
      meta.innerHTML = `<span>${esc(r.provider === 'anthropic' ? 'Claude' : r.provider === 'openai' ? 'GPT' : r.provider === 'gemini' ? 'Gemini' : r.provider)} · ${(r.ms / 1000).toFixed(1).replace('.', ',')} с</span>`;
      let pre = null;
      if (r.queries && r.queries.length) {
        const b = document.createElement('button'); b.type = 'button'; b.textContent = `запросы к базе: ${r.queries.length}`;
        b.setAttribute('aria-expanded', 'false');
        pre = document.createElement('div'); pre.className = 'as-q'; pre.hidden = true;
        pre.textContent = r.queries.map(x => `— ${x.why}\n${x.sql}\n${x.error ? 'ошибка: ' + x.error : 'строк: ' + x.rows}`).join('\n\n');
        b.onclick = () => { pre.hidden = !pre.hidden; b.setAttribute('aria-expanded', String(!pre.hidden)); };
        meta.appendChild(b);
      }
      const msg = add('a', r.answer, meta);
      if (pre) msg.appendChild(pre);
      history.push({ q, a: r.answer });
      if (voice || info.settings.speak) say(r.speech || r.answer);
    } catch (e) {
      t.remove();
      add('a', 'Не получилось ответить: ' + (e.message || e), null).classList.add('err');
    } finally { busy = false; }
  }
  $('as-form').onsubmit = e => { e.preventDefault(); send($('as-in').value, false); };
  const autosize = () => { const t = $('as-in'); t.style.height = 'auto'; t.style.height = Math.min(140, t.scrollHeight) + 'px'; t.style.overflowY = t.scrollHeight > 140 ? 'auto' : 'hidden'; };
  $('as-in').addEventListener('input', autosize);
  $('as-in').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send($('as-in').value, false); } });

  /* ---------- озвучка ---------- */
  let audioEl = null;
  function stopSpeaking() { try { speechSynthesis.cancel(); } catch (_) { /* нет синтеза */ } if (audioEl) { audioEl.pause(); audioEl = null; } $('as-spk').classList.remove('on'); }
  $('as-stop').onclick = stopSpeaking;
  const ruVoices = () => (window.speechSynthesis ? speechSynthesis.getVoices() : []).filter(v => /^ru/i.test(v.lang));
  async function say(text) {
    const s = info.settings;
    stopSpeaking();
    if (s.tts === 'off' || !text) return;
    $('as-spk').classList.add('on');
    if (s.tts !== 'system') {   // живой голос: OpenAI / Gemini / Yandex (выбирает основной процесс), иначе — Windows
      try {
        const a = await A.speak(text);
        audioEl = new Audio(URL.createObjectURL(new Blob([Uint8Array.from(atob(a.base64), c => c.charCodeAt(0))], { type: a.mime })));
        audioEl.onended = () => $('as-spk').classList.remove('on');
        await audioEl.play();
        return;
      } catch (e) { if (s.tts !== 'auto' || !/Нет ключа/.test(e.message || '')) note('Живой голос недоступен (' + (e.message || e) + ') — говорю голосом Windows.'); }
    }
    const list = ruVoices();
    // среди голосов Windows лучше звучат «естественные» (Natural/Online), если они установлены
    const v = list.find(x => x.name === s.voice) || list.find(x => /Natural|Online/i.test(x.name)) || list[0];
    if (!v) { $('as-spk').classList.remove('on'); note('В Windows не установлен русский голос. Параметры Windows → Время и язык → Речь → «Добавить голоса» → Русский. Или подключите GPT, Gemini или YandexGPT — у них живые голоса.'); return; }
    const u = new SpeechSynthesisUtterance(text.replace(/₽/g, ' рублей').replace(/\s*·\s*/g, ', ')); u.voice = v; u.lang = v.lang; u.rate = 1;
    u.onend = u.onerror = () => $('as-spk').classList.remove('on');
    speechSynthesis.speak(u);
  }
  let noted = new Set();
  function note(t) { if (noted.has(t)) return; noted.add(t); add('a', t); }

  /* ---------- запись голоса: WAV 16 кГц, автоостановка по тишине ---------- */
  let rec = null;
  async function startRec() {
    if (rec || busy) return;
    if (!info.stt) { add('a', info.ai ? 'Для голоса нужен ключ Gemini или GPT: Claude не умеет распознавать речь. Пока можно спрашивать текстом.' : 'ИИ не подключён. Добавьте ключ Gemini или GPT в «Подключениях», чтобы говорить голосом.'); return; }
    stopSpeaking();
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
    catch (e) { add('a', 'Нет доступа к микрофону. Проверьте: Параметры Windows → Конфиденциальность → Микрофон → разрешить настольным приложениям.').classList.add('err'); return; }
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    const chunks = []; const t0 = performance.now();
    let spoke = false, lastVoice = t0;
    proc.onaudioprocess = ev => {
      const d = ev.inputBuffer.getChannelData(0);
      chunks.push(new Float32Array(d));
      let sum = 0; for (let i = 0; i < d.length; i++) sum += d[i] * d[i];
      const rms = Math.sqrt(sum / d.length), now = performance.now();
      $('as-lvl').style.width = Math.min(100, rms * 900) + '%';
      if (rms > 0.02) { spoke = true; lastVoice = now; }
      const auto = info.settings.autoStop !== false;
      if (auto && spoke && now - lastVoice > 1400) stopRec();
      else if (auto && !spoke && now - t0 > 7000) stopRec(true, 'Не слышу речи — попробуйте ещё раз ближе к микрофону.');
      else if (now - t0 > 30000) stopRec();
    };
    src.connect(proc); proc.connect(ctx.destination);
    rec = { stream, ctx, proc, src, chunks, rate: ctx.sampleRate };
    btn.classList.add('rec'); $('as-mic').classList.add('rec'); $('as-rec').classList.add('on');
    $('as-rect').textContent = info.settings.autoStop !== false ? 'Слушаю… закончите фразу — отправлю сам' : 'Слушаю… нажмите микрофон ещё раз, чтобы отправить';
  }
  function cleanup() {
    if (!rec) return null;
    const r = rec; rec = null;
    try { r.proc.disconnect(); r.src.disconnect(); } catch (_) { /* уже отключено */ }
    r.stream.getTracks().forEach(t => t.stop());
    r.ctx.close();
    btn.classList.remove('rec'); $('as-mic').classList.remove('rec'); $('as-rec').classList.remove('on'); $('as-lvl').style.width = '0';
    return r;
  }
  async function stopRec(cancel, msg) {
    const r = cleanup(); if (!r) return;
    if (cancel) { if (msg) add('a', msg); return; }
    const wav = encodeWav(r.chunks, r.rate, 16000);
    if (wav.byteLength < 9000) return add('a', 'Запись слишком короткая — скажите вопрос целиком.');
    const t = typing();
    try {
      const b64 = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.readAsDataURL(new Blob([wav], { type: 'audio/wav' })); });
      const tr = await A.transcribe({ mime: 'audio/wav', base64: b64 });
      t.remove();
      if (!tr.text) return add('a', 'Не разобрал слова — повторите, пожалуйста.');
      send(tr.text, true);
    } catch (e) { t.remove(); add('a', 'Не удалось распознать речь: ' + (e.message || e)).classList.add('err'); }
  }
  $('as-mic').onclick = () => (rec ? stopRec() : startRec());
  $('as-cancel').onclick = () => stopRec(true);

  function encodeWav(chunks, inRate, outRate) {
    const len = chunks.reduce((a, c) => a + c.length, 0), all = new Float32Array(len);
    let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
    const k = inRate / outRate, n = Math.floor(len / k), pcm = new Int16Array(n);
    for (let i = 0; i < n; i++) { // усреднение по окну — простой фильтр от наложения частот
      const a = Math.floor(i * k), b = Math.min(len, Math.floor((i + 1) * k)); let s = 0; for (let j = a; j < b; j++) s += all[j];
      const v = Math.max(-1, Math.min(1, s / Math.max(1, b - a))); pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
    }
    const buf = new ArrayBuffer(44 + pcm.length * 2), dv = new DataView(buf);
    const w = (p, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(p + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); dv.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE'); w(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, outRate, true); dv.setUint32(28, outRate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, pcm.length * 2, true);
    new Int16Array(buf, 44).set(pcm);
    return buf;
  }

  /* ---------- состояние и настройки голоса ---------- */
  async function refreshInfo() {
    try { info = await A.info(); } catch (_) { return; }
    const sttName = { gemini: 'Gemini', openai: 'GPT', groq: 'Groq', mock: 'тест' }[info.stt];
    const sp = info.speech || { engines: {} }, t = info.settings.tts;
    const eng = t === 'auto' ? sp.auto : t;
    const how = t === 'off' ? 'без озвучки' : t === 'system' || !eng || !(sp.engines[eng] || {}).ready ? 'голосом Windows' : 'голосом ' + sp.engines[eng].title;
    $('as-st').textContent = !info.ai ? 'ИИ не подключён — откройте «Подключения»' : sttName ? `Голос распознаёт ${sttName} · ответы ${how}` : `Только текст: для голоса нужен Gemini, GPT или Groq · ответы ${how}`;
    $('as-mic').disabled = !info.stt;
    $('as-mic').title = info.stt ? 'Сказать голосом (Ctrl+Shift+Пробел)' : 'Для голоса нужен ключ Gemini или GPT';
  }
  function renderSettings() {
    const s = info.settings, voices = ruVoices(), sp = info.speech || { engines: {} };
    const eng = s.tts === 'auto' ? sp.auto : (sp.engines[s.tts] ? s.tts : null);
    const opt = (v, t, cur) => `<option value="${esc(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(t)}</option>`;
    $('as-set').innerHTML = `<div class="cn-row"><label>Распознавание речи<select id="as-s-stt">${opt('auto', 'Автоматически (Gemini, затем GPT)', s.stt)}${opt('gemini', 'Gemini', s.stt)}${opt('openai', 'GPT (OpenAI)', s.stt)}${opt('groq', 'Groq (Whisper)', s.stt)}</select></label></div>
      <div class="cn-row"><label>Озвучка ответов<select id="as-s-tts">${opt('auto', `Авто — живой голос${sp.auto ? ' (' + sp.engines[sp.auto].title + ')' : ', если есть ключ'}`, s.tts)}${['openai', 'gemini', 'yandex'].map(id => opt(id, `${({ openai: 'OpenAI — голоса marin, cedar', gemini: 'Gemini — 30 голосов', yandex: 'Yandex SpeechKit — русские голоса' })[id]}${(sp.engines[id] || {}).ready ? '' : ' (нужен ключ)'}`, s.tts)).join('')}${opt('system', 'Голос Windows (без интернета)', s.tts)}${opt('off', 'Без озвучки', s.tts)}</select></label></div>
      ${eng && sp.engines[eng] && s.tts !== 'system' && s.tts !== 'off' ? `<div class="cn-row"><label>Голос ${esc(sp.engines[eng].title)}<select id="as-s-lv" data-eng="${eng}">${sp.engines[eng].voices.map(([v, t]) => opt(v, t, (s.voices || {})[eng] || (eng === 'openai' && s.openaiVoice) || sp.engines[eng].def)).join('')}</select></label></div>` : ''}
      <div class="cn-row" ${s.tts === 'system' || !eng ? '' : 'style="display:none"'}><label>Голос Windows${s.tts !== 'system' ? ' (если живой недоступен)' : ''}<select id="as-s-voice">${voices.length ? voices.map(v => opt(v.name, v.name + (/Natural|Online/i.test(v.name) ? ' — естественный' : ''), s.voice)).join('') : '<option value="">русский голос не установлен</option>'}</select></label></div>
      <div class="as-switches">
        <label class="cn-prim"><input type="checkbox" role="switch" id="as-s-speak" ${s.speak ? 'checked' : ''}>Озвучивать и ответы на вопросы, заданные текстом</label>
        <label class="cn-prim"><input type="checkbox" role="switch" id="as-s-auto" ${s.autoStop !== false ? 'checked' : ''}>Отправлять, когда я замолчал</label>
        <label class="cn-prim"><input type="checkbox" role="switch" id="as-s-hk" ${s.globalHotkey ? 'checked' : ''}>Ctrl+Shift+Пробел открывает помощника из любой программы</label></div>
      ${!voices.length && s.tts === 'system' ? '<p class="as-note">Русский голос Windows: Параметры → Время и язык → Речь → «Добавить голоса» → Русский. После установки перезапустите программу.</p>' : ''}
      <div class="cn-row"><button class="bn gh" type="button" id="as-s-test">Проверить голос</button><button class="bn gh" type="button" id="as-s-clear">Очистить историю</button></div>`;
  }
  $('as-gear').onclick = () => { const s = $('as-set'); s.hidden = !s.hidden; $('as-gear').setAttribute('aria-expanded', String(!s.hidden)); if (!s.hidden) renderSettings(); };
  $('as-set').onchange = async e => {
    const map = { 'as-s-stt': ['stt', e.target.value], 'as-s-tts': ['tts', e.target.value], 'as-s-voice': ['voice', e.target.value], 'as-s-ov': ['openaiVoice', e.target.value],
      'as-s-speak': ['speak', e.target.checked], 'as-s-auto': ['autoStop', e.target.checked], 'as-s-hk': ['globalHotkey', e.target.checked] };
    if (e.target.id === 'as-s-lv') { info = await A.set({ voices: { [e.target.dataset.eng]: e.target.value } }); renderSettings(); return; }
    const m = map[e.target.id]; if (!m) return;
    info = await A.set({ [m[0]]: m[1] }); renderSettings(); refreshInfo();
  };
  $('as-set').onclick = async e => {
    if (e.target.id === 'as-s-test') say('Привет! Я помощник по вашим финансам. Спросите, например, сколько вы потратили в этом месяце.');
    if (e.target.id === 'as-s-clear') { await A.clear(); history.length = 0; $('as-log').innerHTML = ''; $('as-chips').hidden = false; }
  };
  if (window.speechSynthesis) speechSynthesis.onvoiceschanged = () => { if (!$('as-set').hidden) renderSettings(); };

  // предыдущие вопросы — в ленту, чтобы разговор продолжался после перезапуска
  A.history().then(h => { h.slice(-6).forEach(x => { add('u', x.q); add('a', x.a); history.push({ q: x.q, a: x.a }); }); if (!h.length) $('as-chips').hidden = false; }).catch(() => {});
  refreshInfo();
  window.FD_openAssistant = opts => open(true, opts);
})();
