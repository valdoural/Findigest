/**
 * Совместимость с веб-версией отчёта.
 * Веб-версия получала базу, сохранение файлов и ИИ через window.claude.use(...).
 * Здесь те же вызовы перенаправляются в настольное приложение:
 *   db        → локальная SQLite (data\digest.db)
 *   user      → локальный профиль
 *   downloads → системный диалог «Сохранить как»
 *   sample    → ИИ-роутер (Claude / Gemini / GPT по ключам из «Подключений»)
 * Благодаря этому разметка, размеры и логика всех листов остаются прежними.
 */
(function () {
  'use strict';
  const N = window.fdNative;
  if (!N) return;

  /* ---------- база ---------- */
  function collection(path) {
    return {
      doc(id) {
        return {
          async get() { const r = await N.store.get(path, id); return { exists: !!r.exists, id, data: () => r.data }; },
          set(data) { return N.store.set(path, id, data); },
          delete() { return N.store.del(path, id); },
        };
      },
      async get() {
        const rows = await N.store.list(path);
        return { docs: rows.map(r => ({ id: r.id, exists: true, data: () => r.data })) };
      },
    };
  }

  /* ---------- картинки для ИИ: Blob → base64, крупные фото уменьшаем ---------- */
  const MAX_SIDE = 2200, MAX_BYTES = 3.5 * 1024 * 1024;
  const toB64 = blob => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = rej; fr.readAsDataURL(blob); });
  async function shrink(blob) {
    if (!/^image\//.test(blob.type || '')) return blob;
    let bmp;
    try { bmp = await createImageBitmap(blob); } catch (_) { return blob; }
    const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    if (k === 1 && blob.size <= MAX_BYTES) return blob;
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise(r => c.toBlob(b => r(b || blob), 'image/jpeg', 0.88));
  }
  async function images(list) {
    const out = [];
    for (const b of list || []) {
      if (!b) continue;
      const s = await shrink(b);
      out.push({ mime: s.type || 'image/jpeg', base64: await toB64(s) });
    }
    return out;
  }

  /* ---------- ИИ ---------- */
  let seq = 0;
  async function ask(prompt, opts, json) {
    opts = opts || {};
    const reqId = 'r' + Date.now() + '-' + (++seq);
    const sig = opts.signal;
    if (sig && sig.aborted) { const e = new Error('Остановлено'); e.name = 'AbortError'; e.code = 'aborted'; throw e; }
    const onAbort = () => N.ai.abort(reqId).catch(() => {});
    if (sig) sig.addEventListener('abort', onAbort, { once: true });
    try {
      const r = await N.ai.run({ reqId, prompt, system: opts.system, images: await images(opts.images), json });
      return r.result;
    } finally { if (sig) sig.removeEventListener('abort', onAbort); }
  }
  const sample = {
    json: (prompt, opts) => ask(prompt, opts, true),
    text: (prompt, opts) => ask(prompt, opts, false),
    limits: async () => ({ images: true, text: true }),
  };

  /* ---------- сохранение файлов ---------- */
  const downloads = {
    async save({ filename, data }) {
      if (typeof data === 'string') return N.downloads.save({ filename, text: data });
      const buf = new Uint8Array(await data.arrayBuffer());
      return N.downloads.save({ filename, bytes: buf });
    },
  };

  window.claude = {
    async use(name) {
      if (name === 'db') return { collection };
      if (name === 'user') return { id: async () => 'local' };
      if (name === 'downloads') return downloads;
      if (name === 'sample') return (await N.ai.available()) ? sample : null;
      return null;
    },
  };
  window.FD_DESKTOP = true;
  // Оформление: светлая тема — исходный вид, тёмная — «Полночь» (desktop/skins.css); прежний выбор варианта больше не нужен
  try { localStorage.removeItem('fd_skin'); } catch (_) { /* хранилище недоступно */ }
  // Данные Zenmoney, пересчитанные в основном процессе. Отчёт ждёт их перед построением листов.
  window.FD_READY = N.digest.data().catch(() => null);
})();
