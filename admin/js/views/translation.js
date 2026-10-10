/**
 * Traducción automática (owner): the DeepL key — saved encrypted, never shown
 * again — an on/off switch, and a test that checks the key and shows this
 * period's usage. With it on, typing in Spanish fills English (and the other
 * way round) in site texts, contact-form options and photo descriptions.
 */
import { h, icon, fill } from '../dom.js';
import { t, fmtDate, getLang } from '../i18n.js';
import { api } from '../api.js';
import { pageHead, loading, loadError, button, setBusy, toast, errorText, alertBox, cardHead, switchInput, passwordField, askPassword } from '../ui.js';

const num = (n) => new Intl.NumberFormat(getLang() === 'en' ? 'en-US' : 'es-GT').format(n);

export async function render({ main }) {
  main.append(pageHead({ title: t('translation.title'), lead: t('translation.lead') }));
  const body = h('div', { class: 'stack-lg' }, loading());
  main.append(body);
  let alive = true;

  const load = async () => {
    let tr;
    try { tr = (await api.get('/settings/translation')).translation; } catch (err) { fill(body, loadError(err, load)); return; }
    if (!alive) return;

    const status = tr.active
      ? alertBox('ok', t('translation.activeTitle'), t('translation.activeBody', { plan: tr.plan, key: tr.keyHint }) + (tr.source === 'env' ? ' ' + t('translation.fromEnv') : ''))
      : tr.source === 'none'
        ? alertBox('info', t('translation.offTitle'), t('translation.noKey'))
        : alertBox('warn', t('translation.pausedTitle'), t('translation.paused'));

    const sw = switchInput({ id: 'tr-on', checked: tr.enabled });
    const key = passwordField({ label: t(tr.keyHint ? 'translation.keyNew' : 'translation.key'), hint: t(tr.keyHint ? 'translation.keyKept' : 'translation.keyHint'), autocomplete: 'off', placeholder: tr.keyHint || '' });
    key.input.spellcheck = false;
    const save = button(t('common.save'), { variant: 'primary', icon: 'check-lg' });
    const removeBtn = tr.source === 'panel' ? button(t('translation.remove'), { variant: 'ghost', small: true, icon: 'trash3' }) : null;
    const submit = async (removeKey) => {
      key.setError(null);
      const v = key.input.value.trim();
      if (v && !/^[A-Za-z0-9-]{20,64}(:fx)?$/.test(v)) { key.setError(t('translation.keyInvalid')); key.input.focus(); return; }
      const password = await askPassword({ title: t('translation.confirm'), lead: t('translation.confirmLead'), confirmLabel: t('common.save') });
      if (password === null) return;
      setBusy(save, true, t('common.saving'));
      try {
        await api.put('/settings/translation', { enabled: sw.input.checked, key: removeKey ? '' : v, removeKey: !!removeKey, currentPassword: password });
        toast(t('translation.saved'));
        load();
        return;
      } catch (err) {
        if (err.code === 'validation' && err.fields.currentPassword) toast(t('fieldErrors.current_password_wrong'), { type: 'bad' });
        else if (err.code === 'validation' && err.fields.key) key.setError(t('translation.keyInvalid'));
        else toast(errorText(err), { type: 'bad' });
      }
      setBusy(save, false);
    };
    save.addEventListener('click', () => submit(false));
    if (removeBtn) removeBtn.addEventListener('click', () => submit(true));

    const result = h('div', { 'aria-live': 'polite' });
    const test = button(t('translation.test'), { icon: 'arrow-repeat', small: true, attrs: { disabled: !tr.active || null } });
    test.addEventListener('click', async () => {
      setBusy(test, true, t('translation.testing'));
      try {
        const r = await api.post('/settings/translation/test', {});
        const pct = r.limit ? Math.round((100 * r.used) / r.limit) : 0;
        fill(result, alertBox(pct > 90 ? 'warn' : 'ok', t('translation.testOk', { plan: r.plan }), t('translation.usage', { used: num(r.used), limit: num(r.limit), pct })),
          h('dl', { class: 'kv kv-tight' }, h('dt', { text: 'ES' }), h('dd', { text: 'Construimos tu proyecto con planificación y precisión.' }), h('dt', { text: 'EN' }), h('dd', { text: r.sample })));
      } catch (err) {
        fill(result, alertBox('bad', t('translation.testFailed'), err.code === 'translation_unavailable' ? t('translation.noKey') : errorText(err)));
      }
      setBusy(test, false);
    });

    const settings = h('section', { class: 'card', 'aria-labelledby': 'tr-set' },
      cardHead({ id: 'tr-set', icon: 'translate', title: t('translation.settingsTitle'), lead: tr.updatedAt ? t('translation.updated', { when: fmtDate(tr.updatedAt) }) : null }),
      h('div', { class: 'stack' },
        h('div', { class: 'rule' }, sw.wrap, h('div', { class: 'grow' }, h('label', { for: 'tr-on', text: t('translation.enabled') }), h('div', { class: 'small muted', text: t('translation.enabledHint') }))),
        key.wrap,
        h('div', { class: 'row-between' }, h('div', { class: 'row' }, test, removeBtn), save),
        result));

    const what = h('section', { class: 'card', 'aria-labelledby': 'tr-what' },
      cardHead({ id: 'tr-what', icon: 'lightbulb', title: t('translation.whatTitle') }),
      h('ul', { class: 'check-list' }, ['what1', 'what2', 'what3', 'what4', 'what5'].map((k) => h('li', null, icon('check2-circle'), h('span', { text: t('translation.' + k, { limit: num(tr.dailyCharLimit) }) })))));
    const how = h('details', { class: 'disclosure help-box', open: tr.source === 'none' || null }, h('summary', null, t('translation.howTitle'), icon('chevron-down')),
      h('ol', null, ['how1', 'how2', 'how3', 'how4'].map((k) => h('li', { text: t('translation.' + k) }))));

    fill(body, status, h('div', { class: 'dash-grid' }, h('div', { class: 'stack-lg' }, settings, how), h('div', { class: 'stack-lg' }, what)));
  };
  await load();
  return { destroy: () => { alive = false; } };
}
