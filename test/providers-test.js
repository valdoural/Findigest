'use strict';
/**
 * Новые ИИ-сервисы (OpenAI-совместимые): каталог, список моделей (текстовые/прочие), запрос, заголовки,
 * YandexGPT (каталог в заголовке и в имени модели), локальные без ключа, готовность в роутере.
 * Локальный сервер изображает API. xvfb-run -a electron --no-sandbox test/providers-test.js
 */
const { app } = require('electron');
const http = require('http'); const fs = require('fs'); const os = require('os'); const path = require('path');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'fd-prov-')));
app.commandLine.appendSwitch('no-sandbox'); app.on('window-all-closed', () => {});
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) process.exitCode = 1; };

app.whenReady().then(async () => {
  try {
    const seen = [];
    const srv = http.createServer((req, res) => {
      let body = ''; req.on('data', d => { body += d; }); req.on('end', () => {
        seen.push({ url: req.url, h: req.headers, body: body ? JSON.parse(body) : null });
        res.setHeader('content-type', 'application/json');
        if (req.url.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'llama-3.3-70b' }, { id: 'qwen2.5:7b' }, { id: 'nomic-embed-text' }, { id: 'whisper-large-v3' }] }));
        if (req.url.endsWith('/chat/completions')) return res.end(JSON.stringify({ choices: [{ message: { content: '{"ok":true,"model":"' + JSON.parse(body).model + '"}' } }] }));
        res.statusCode = 404; res.end('{}');
      });
    }).listen(0);
    const base = `http://127.0.0.1:${srv.address().port}/v1`;
    require('../src/main/paths').P.ensure();
    const S = require('../src/main/config/settings'); S.load();
    const sec = require('../src/main/config/secrets'); await sec.load();
    require('../src/main/db/database').open();
    const ai = require('../src/main/ai/router');
    const { CATALOG } = require('../src/main/ai/providers/compat');
    const ids = Object.keys(ai.PROVIDERS);
    ok(CATALOG.length >= 15 && ids.length >= 19, `сервисов ИИ: ${ids.length} (новых ${CATALOG.length}): ${CATALOG.map(c => c.title).join(', ')}`);
    ok(sec.KNOWN.deepseek_api_key && sec.KNOWN.gigachat_api_key && !sec.KNOWN.ollama_api_key, 'ключи новых сервисов — в secrets.json (у локальных ключа нет)');
    ok(ai.describe().every(p => p.logo && p.group), 'у каждого сервиса есть значок и группа (мировые / российские / на своём компьютере)');

    // Ollama без ключа: список моделей и ответ
    S.patch('ai', { extra: { ollama: { baseUrl: base } }, enabled: { ...S.get().ai.enabled, ollama: true } });
    const lm = await ai.models('ollama', { refresh: true });
    const chat = lm.list.filter(m => m.chat).map(m => m.id), other = lm.list.filter(m => !m.chat).map(m => m.id);
    ok(chat.join() === 'llama-3.3-70b,qwen2.5:7b' && other.length === 2, `Ollama без ключа: текстовые ${chat.join(', ')}; прочие ${other.join(', ')}`);
    ok(S.get().ai.models.ollama === 'llama-3.3-70b' && ai.describe().find(p => p.id === 'ollama').ready, 'модель выбрана сама, сервис готов');
    S.patch('ai', { primary: 'ollama' });
    const r = await ai.run({ prompt: 'тест', json: true });
    ok(r.provider === 'ollama' && r.result.ok === true && !seen.find(x => x.url.endsWith('/chat/completions')).h.authorization, 'запрос к Ollama: JSON разобран, без заголовка ключа');

    // YandexGPT: ключ Bearer, каталог в OpenAI-Project и в имени модели gpt://<каталог>/…
    await sec.set('yandex_api_key', 'AQVN-test');
    S.patch('ai', { extra: { ...S.get().ai.extra, yandex: { baseUrl: base, folder: 'b1gfolder' } }, models: { ...S.get().ai.models, yandex: 'yandexgpt/latest' }, enabled: { ...S.get().ai.enabled, yandex: true }, primary: 'yandex' });
    ok(ai.describe().find(p => p.id === 'yandex').ready, 'YandexGPT готов: ключ, каталог и модель заданы');
    seen.length = 0;
    const y = await ai.run({ prompt: 'тест', json: true });
    const q = seen.find(x => x.url.endsWith('/chat/completions'));
    ok(y.provider === 'yandex' && q.h.authorization === 'Bearer AQVN-test' && q.h['openai-project'] === 'b1gfolder' && q.body.model === 'gpt://b1gfolder/yandexgpt/latest', 'YandexGPT: Bearer-ключ, каталог в OpenAI-Project, модель gpt://b1gfolder/yandexgpt/latest');
    // без каталога сервис не считается готовым
    S.patch('ai', { extra: { ...S.get().ai.extra, yandex: { baseUrl: base, folder: '' } } });
    ok(!ai.describe().find(p => p.id === 'yandex').ready, 'YandexGPT без ID каталога — не готов (обязательное поле)');
    // Perplexity: списка моделей в API нет — предлагаются известные
    const pp = ai.PROVIDERS.perplexity;
    const pl = await pp.listModels('x', {});
    ok(pl.length === 4 && pl[0].id === 'sonar', 'Perplexity: известные модели без запроса списка (' + pl.map(m => m.id).join(', ') + ')');
    // Groq умеет распознавать речь
    ok(typeof ai.PROVIDERS.groq.transcribe === 'function', 'Groq распознаёт речь (Whisper) — помощник может слушать и с ним');
    srv.close();
  } catch (e) { console.error(e); process.exitCode = 1; }
  app.exit(process.exitCode || 0);
});
