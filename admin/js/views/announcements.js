/**
 * Avisos al equipo (owner) — e-mails the team the panel's «Novedades»: each
 * person gets, in their language, only the items they can use, with the link
 * to the wiki, and never the same item twice. See cms/src/Announcements.php.
 */
import { h, icon, fill, initials } from '../dom.js';
import { t, tp, fmtDate } from '../i18n.js';
import { api } from '../api.js';
import { pageHead, loading, loadError, alertBox, button, setBusy, toast, errorText, fieldErrorText, cardHead, textField, confirmDialog } from '../ui.js';
import { permissionList } from '../access.js';

const dayTs = (d) => Math.floor(Date.parse(d + 'T12:00:00') / 1000);

export async function render({ main }) {
  main.append(pageHead({ title: t('announce.title'), lead: t('announce.lead') }));
  const body = h('div', { class: 'stack-lg' }, loading());
  main.append(body);

  const chosen = new Set();
  let data = null;
  let current = [];
  let again = false;
  let unseenOnly = false;
  let timer = null;
  let alive = true;

  const message = textField({ id: 'announce-message', label: t('announce.messageLabel'), hint: t('announce.messageHint'), max: 600, multiline: true, rows: 4, optionalTag: true });
  const people = h('div', { class: 'stack-sm', 'aria-live': 'polite' });
  const testBtn = button(t('announce.test'), { icon: 'envelope' });
  const sendBtn = button(tp('announce.send', 0), { variant: 'primary', icon: 'send' });
  const result = h('div');
  // Phones: the list is long, so who gets it and «Enviar» stay in a bar at the bottom.
  const barText = h('span', { class: 'savebar-text' }, h('span', { class: 'dot', 'aria-hidden': 'true' }), h('span'));
  const barSend = button(tp('announce.send', 0), { variant: 'primary', icon: 'send' });
  barSend.addEventListener('click', () => sendBtn.click());
  const bar = h('div', { class: 'savebar announce-bar', role: 'region', 'aria-label': t('announce.step3') }, barText, h('div', { class: 'actions' }, barSend));
  bar.inert = true;
  main.append(bar);

  const updateButtons = () => {
    sendBtn.lastChild.textContent = tp('announce.send', current.length);
    sendBtn.disabled = !current.length || !data.mailReady;
    testBtn.disabled = !chosen.size || !data.mailReady;
    barText.lastChild.textContent = tp('announce.barCount', current.length);
    barSend.lastChild.textContent = sendBtn.lastChild.textContent;
    barSend.disabled = sendBtn.disabled;
    const show = current.length > 0 && data.mailReady;
    bar.classList.toggle('show', show);
    bar.inert = !show;
  };
  // Only the latest answer counts: an earlier one arriving late must not overwrite it.
  let seq = 0;
  const loadPeople = async () => {
    const mine = ++seq;
    if (!chosen.size) {
      current = [];
      fill(people, h('p', { class: 'muted', text: t('announce.pickOne') }));
      updateButtons();
      return;
    }
    try {
      const r = await api.post('/announcements/recipients', { ids: [...chosen], again, unseenOnly });
      if (mine !== seq) return;
      current = r.recipients;
    } catch (err) {
      if (mine !== seq) return;
      current = [];
      fill(people, alertBox('bad', null, errorText(err)));
      updateButtons();
      return;
    }
    if (!alive) return;
    fill(people, current.length
      ? [h('p', { class: 'announce-count', text: tp('announce.count', current.length) }),
        h('ul', { class: 'announce-people' }, current.map((p) => h('li', null,
          h('span', { class: 'avatar', 'aria-hidden': 'true', text: initials(p.name) }),
          h('span', { class: 'grow' }, h('strong', { class: 'break', text: p.name }),
            h('span', { class: 'tiny muted', text: tp('announce.itemsN', p.items.length) + ' · ' + (p.lang === 'en' ? 'English' : 'Español') })))))]
      : alertBox('info', null, t('announce.nobody')));
    updateButtons();
  };
  const refresh = () => { clearTimeout(timer); timer = setTimeout(loadPeople, 200); };

  const who = (n) => (n.canAsk ? t('announce.forAsk') : n.perms.length ? t('announce.forPerms', { list: permissionList(n.perms) }) : t('announce.forAll'));
  const itemRow = (n) => {
    const id = 'announce-' + n.id;
    const box = h('input', { type: 'checkbox', id, checked: chosen.has(n.id) });
    box.addEventListener('change', () => { if (box.checked) chosen.add(n.id); else chosen.delete(n.id); refresh(); });
    const done = n.eligible > 0 && n.emailed >= n.eligible;
    return h('li', { class: ['announce-item', done && 'is-done'] }, box,
      h('label', { for: id },
        h('span', { class: 'announce-item-head' }, h('strong', { text: n.title }), h('span', { class: 'tiny muted nowrap', text: fmtDate(dayTs(n.date), false) })),
        n.summary ? h('span', { class: 'small muted', text: n.summary }) : null,
        h('span', { class: 'tiny announce-who' }, icon('people'), h('span', { text: who(n) })),
        h('span', { class: ['tiny', done ? 'announce-done' : 'muted'] }, done ? icon('check-circle-fill') : null,
          h('span', { text: n.eligible ? t('announce.stats', { eligible: n.eligible, seen: n.seen, emailed: n.emailed }) : t('announce.noOne') }))));
  };
  const option = (id, label, onChange) => {
    const box = h('input', { type: 'checkbox', id });
    box.addEventListener('change', () => { onChange(box.checked); refresh(); });
    return h('label', { class: 'check', for: id }, box, h('span', { text: label }));
  };

  const historyCard = () => h('section', { class: 'card', 'aria-labelledby': 'announce-h' },
    cardHead({ id: 'announce-h', icon: 'clock-history', title: t('announce.history') }),
    data.history.length
      ? h('ul', { class: 'announce-history' }, data.history.map((a) => h('li', null,
        h('span', { class: 'grow' },
          h('strong', { text: a.news.map((id) => (data.news.find((n) => n.id === id) || { title: id }).title).join(' · ') }),
          h('span', { class: 'tiny muted', text: [fmtDate(a.at), a.by ? t('announce.by', { name: a.by }) : null].filter(Boolean).join(' · ') })),
        h('span', { class: 'badge badge-ok nowrap', text: tp('announce.historyRow', a.recipients) }),
        a.failed ? h('span', { class: 'badge badge-bad nowrap', text: tp('announce.historyFailed', a.failed) }) : null)))
      : h('p', { class: 'muted', text: t('announce.historyEmpty') }));

  const load = async () => {
    try { data = await api.get('/announcements'); } catch (err) { fill(body, loadError(err, load)); return; }
    if (!alive) return;
    if (!chosen.size) for (const n of data.news) if (n.eligible > n.emailed) chosen.add(n.id);
    fill(body,
      data.mailReady ? null : alertBox('warn', null, t('announce.noMail'), h('a', { class: 'btn btn-sm', href: '#/correo' }, icon('envelope'), t('announce.openEmail'))),
      // Wide screens: the list on the left; the message, who gets it and «Enviar» stay in view on the right.
      h('div', { class: 'announce-layout' },
        h('section', { class: 'card', 'aria-labelledby': 'announce-1' },
          cardHead({ id: 'announce-1', icon: 'star-fill', title: t('announce.step1'), lead: t('announce.step1Lead') }),
          data.news.length ? h('ul', { class: 'announce-list' }, data.news.map(itemRow)) : h('p', { class: 'muted', text: t('announce.noNews') })),
        h('div', { class: 'announce-side stack-lg' },
          h('section', { class: 'card', 'aria-labelledby': 'announce-2' },
            cardHead({ id: 'announce-2', icon: 'card-text', title: t('announce.step2') }),
            message.wrap),
          h('section', { class: 'card', 'aria-labelledby': 'announce-3' },
            cardHead({ id: 'announce-3', icon: 'people', title: t('announce.step3') }),
            h('div', { class: 'stack-sm announce-options' },
              option('announce-unseen', t('announce.unseenOnly'), (v) => { unseenOnly = v; }),
              option('announce-again', t('announce.again'), (v) => { again = v; })),
            people,
            h('div', { class: 'row announce-actions' }, testBtn, sendBtn),
            result))),
      historyCard());
    await loadPeople();
  };

  testBtn.addEventListener('click', async () => {
    message.setError(null);
    setBusy(testBtn, true, t('announce.sending'));
    try {
      const r = await api.post('/announcements/test', { ids: [...chosen], message: message.input.value });
      toast(r.sent ? t('announce.testSent', { to: r.to }) : t('announce.testFailed'), { type: r.sent ? 'ok' : 'bad' });
    } catch (err) {
      if (err.code === 'validation' && err.fields && err.fields.message) message.setError(fieldErrorText(err.fields.message, { max: 600 }));
      else toast(errorText(err), { type: 'bad' });
    }
    setBusy(testBtn, false);
  });

  sendBtn.addEventListener('click', async () => {
    message.setError(null);
    const n = current.length;
    if (!(await confirmDialog({ title: t('announce.confirmTitle'), body: tp('announce.confirmBody', n), confirmLabel: t('announce.confirm') }))) return;
    setBusy(sendBtn, true, t('announce.sending'));
    try {
      const r = await api.post('/announcements/send', { ids: [...chosen], message: message.input.value, again, unseenOnly });
      toast(tp('announce.sent', r.sent));
      chosen.clear();
      await load();
      if (r.failed) fill(result, alertBox('warn', null, t('announce.failed', { names: r.failedNames.join(', ') })));
      return;
    } catch (err) {
      if (err.code === 'validation' && err.fields && err.fields.message) message.setError(fieldErrorText(err.fields.message, { max: 600 }));
      else toast(errorText(err), { type: 'bad' });
    }
    setBusy(sendBtn, false);
  });

  await load();
  return { destroy: () => { alive = false; clearTimeout(timer); bar.remove(); } };
}

