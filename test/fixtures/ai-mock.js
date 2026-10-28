'use strict';
/** Тестовый ИИ для автотестов помощника (FD_AI_MOCK=этот файл). Не попадает в сборку. */
const Q = "SELECT ROUND(SUM(amount_rub),2) s FROM v_ops WHERE type='expense' AND in_balance=1 AND category='Продукты' AND month='2026-09'";
module.exports = {
  id: 'mock', title: 'Тест', keyName: 'mock', defaultModel: 'mock',
  calls: [],
  async listModels() { return ['mock']; },
  async complete({ prompt, system }) {
    module.exports.calls.push({ prompt, system });
    if (prompt.includes('Листы отчёта')) {
      if (module.exports.failInsights === '429once') { module.exports.failInsights = false; throw Object.assign(new Error('Лимит ИИ: слишком много запросов за минуту'), { code: 'rate_limited', retryAfterMs: 2000 }); }
      if (module.exports.failInsights) throw Object.assign(new Error('сервис перегружен'), { code: 'overloaded' });
      const snap = JSON.parse(prompt.split('Данные (JSON):\n')[1].split('\n\nЛисты отчёта')[0]);
      const m = snap.текущий_месяц || {};
      const out = {};
      for (let i = 1; i <= 6; i++) out['sheet' + i] = [{ tag: 'Лист ' + i, text: `Расходы месяца ${m.расходы_с_возвратами} ₽ при прогнозе ${m.прогноз_всего} ₽.`, tone: i % 2 ? 'warn' : 'good' }, { tag: 'Справка', text: 'Нейтральное наблюдение <b>без разметки</b>.', tone: 'info' }];
      out.sheet6 = []; // для «Питания» данных нет — карточка не показывается
      return JSON.stringify(out);
    }
    if (prompt.includes('последние опубликованные официальные данные для субъекта')) {
      const name = prompt.split('субъекта «')[1].split('»')[0];
      return JSON.stringify({ region: { salary: { value: name === 'Москва' ? 160000 : 99000, period: 'июль 2026' }, savings: null, food: { value: 24.5, period: 'II кв. 2026' }, cafe: { value: 999, period: 'ошибка' }, source: 'Тест-стат' },
        rf: { salary: { value: 115000, period: 'июль 2026' }, median: { value: 76000, period: '2026' }, savings: { value: 5.1, period: 'I пол. 2026' }, food: { value: 21.5, period: 'II кв. 2026' }, cafe: null, alcohol: { value: 1.2, period: '2026' }, source: 'Росстат' } });
    }
    if (prompt.includes('Результаты запросов')) {
      const res = JSON.parse(prompt.split('(JSON):\n')[1].split('\n\nСформулируй')[0]);
      const s = res[0].rows[0].s;
      return JSON.stringify({ answer: `На продукты в сентябре ушло **${s} ₽**.\n- запросов: ${res.length}\n- ошибок: ${res.filter(x => x.error).length}`, speech: `На продукты ушло ${Math.round(s)} рублей.` });
    }
    if (/продукт/i.test(prompt.split('Вопрос: ').pop())) {
      return JSON.stringify({ queries: [
        { why: 'продукты за сентябрь', sql: Q },
        { why: 'попытка удалить', sql: 'DELETE FROM zm_tx' },
        { why: 'два запроса', sql: 'SELECT 1; DROP TABLE zm_tx' },
      ] });
    }
    return JSON.stringify({ answer: 'Привет! Спросите о расходах.', speech: 'Привет!' });
  },
  async transcribe({ audio }) {
    if (!audio || audio.mime !== 'audio/wav' || Buffer.from(audio.base64, 'base64').subarray(0, 4).toString() !== 'RIFF') throw new Error('ожидался WAV');
    module.exports.lastAudioBytes = Buffer.from(audio.base64, 'base64').length;
    return 'Сколько я потратил на продукты в сентябре?';
  },
  async speak() { return { mime: 'audio/wav', base64: '' }; },
};
