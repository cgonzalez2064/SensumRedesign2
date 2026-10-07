/** "Reportar un problema" — available from every screen of the panel. */
import { h, icon, clear } from './dom.js';
import { t, getLang } from './i18n.js';
import { getThemePref } from './theme.js';
import { api, upload } from './api.js';
import { openDialog, textField, alertBox, errorText, fieldErrorText, setBusy, toast, button } from './ui.js';
import { technicalContext, safeRoute } from './telemetry.js';

const MAX_SCREENSHOT = 5 * 1024 * 1024;
const TYPES = ['problem', 'improvement', 'content', 'design', 'other'];
const AREAS = ['website', 'admin', 'both'];

function chipGroup(name, values, labels, selected, legend) {
  const group = h('fieldset', { class: 'field fieldset-reset' },
    h('legend', { class: 'label', text: legend }),
    h('div', { class: 'chips' }, values.map((v) => {
      const id = `${name}-${v}`;
      return h('div', { class: 'chip' },
        h('input', { type: 'radio', name, id, value: v, checked: v === selected }),
        h('label', { for: id, text: labels[v] }));
    })));
  return group;
}

export function openReportDialog() {
  const lang = getLang();
  const context = technicalContext({ lang, theme: getThemePref() });
  const typeGroup = chipGroup('rtype', TYPES, t('report.types'), 'problem', t('report.type'));
  const titleF = textField({ label: t('report.titleLabel'), placeholder: t('report.titlePlaceholder'), max: 120, required: true });
  const descF = textField({ label: t('report.description'), placeholder: t('report.descriptionPlaceholder'), max: 4000, multiline: true, rows: 5, required: true });
  const areaGroup = chipGroup('rarea', AREAS, t('report.areas'), 'admin', t('report.area'));
  const pageF = textField({ label: t('report.page'), value: location.pathname + safeRoute(), hint: t('report.pageHint'), max: 300, optionalTag: true });

  // Optional screenshot (validated again on the server).
  let shot = null;
  const shotInput = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', class: 'sr-only', id: 'report-shot' });
  const shotInfo = h('div', { class: 'row' });
  const shotErr = h('div', { class: 'field-error', hidden: true });
  const renderShot = () => {
    clear(shotInfo);
    if (shot) {
      const url = URL.createObjectURL(shot);
      shotInfo.append(h('img', { src: url, alt: '', width: 56, height: 42, class: 'slot-media', onload: () => URL.revokeObjectURL(url) }),
        h('span', { class: 'small grow break', text: shot.name }),
        button(t('report.removeScreenshot'), { small: true, variant: 'ghost', icon: 'trash3', onClick: () => { shot = null; shotInput.value = ''; renderShot(); } }));
    } else {
      shotInfo.append(h('label', { class: 'btn btn-sm', for: 'report-shot' }, icon('image'), t('report.addScreenshot')));
    }
  };
  shotInput.addEventListener('change', () => {
    const f = shotInput.files && shotInput.files[0];
    shotErr.hidden = true;
    if (!f) return;
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) { shotErr.textContent = fieldErrorText('file_type_not_allowed', { formats: 'JPG, PNG, WebP' }); shotErr.hidden = false; shotInput.value = ''; return; }
    if (f.size > MAX_SCREENSHOT) { shotErr.textContent = fieldErrorText('file_too_large', { max: '5 MB' }); shotErr.hidden = false; shotInput.value = ''; return; }
    shot = f;
    renderShot();
  });
  renderShot();

  const ctxList = h('dl', { class: 'kv context-list' }, Object.entries(context).map(([k, v]) => [
    h('dt', { text: t('report.context.' + k) }),
    h('dd', { text: k === 'device' ? t('report.devices.' + v) : k === 'theme' ? t('theme.' + v) : k === 'lang' ? t('langs.' + v) : k === 'online' ? t('report.connection.' + v) : v }),
  ]));
  const status = h('div', { 'aria-live': 'polite' });
  const form = h('form', { class: 'stack', novalidate: true },
    typeGroup, titleF.wrap, descF.wrap, areaGroup, pageF.wrap,
    h('div', { class: 'field' }, h('span', { class: 'label', text: t('report.screenshot') + ' ' }, h('span', { class: 'opt', text: '(' + t('common.optional') + ')' })),
      shotInput, shotInfo, h('span', { class: 'hint', text: t('report.screenshotHint') }), shotErr),
    alertBox('info', null, t('report.privacy')),
    h('p', { class: 'small', }, h('strong', { text: t('report.noSensitive') })),
    h('details', { class: 'disclosure' }, h('summary', null, t('report.whatIsSent'), icon('chevron-down')), ctxList),
    status);

  let reportId = null;
  const dlg = openDialog({
    title: t('report.title'), lead: t('report.lead'), labelledIcon: 'life-preserver', body: form, wide: true,
    actions: [
      { label: t('common.cancel'), onClick: (b, close) => close() },
      { label: t('report.send'), variant: 'primary', icon: 'send', onClick: () => form.requestSubmit() },
    ],
  });
  const sendBtn = dlg.foot.lastChild;
  setTimeout(() => titleF.input.focus(), 60);

  const showResult = (delivered) => {
    clear(dlg.body).append(delivered
      ? h('div', { class: 'empty' }, h('span', { class: 'icon-tile' }, icon('check-circle-fill')), h('h3', { text: t('report.sentTitle') }), h('p', { text: t('report.sent') }), h('p', { class: 'muted small', text: t('report.sentMore') }))
      : alertBox('warn', t('report.failedTitle'), t('report.failed')));
    clear(dlg.foot);
    if (!delivered) {
      const retry = button(t('report.done'), { onClick: () => dlg.close() });
      const again = button(t('common.retry'), { variant: 'primary', icon: 'arrow-repeat' });
      again.addEventListener('click', async () => {
        setBusy(again, true, t('report.sending'));
        try {
          const r = await api.postWithStatus(`/reports/${reportId}/retry`, {});
          if (r.data.delivered) { showResult(true); } else { setBusy(again, false); toast(t('reports.retryFailed'), { type: 'warn' }); }
        } catch (err) { setBusy(again, false); toast(errorText(err), { type: 'bad' }); }
      });
      dlg.foot.append(retry, again);
    } else {
      const done = button(t('report.done'), { variant: 'primary', onClick: () => dlg.close() });
      dlg.foot.append(done);
      done.focus();
    }
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clear(status);
    titleF.setError(null); descF.setError(null); pageF.setError(null);
    const title = titleF.input.value.trim();
    const desc = descF.input.value.trim();
    let bad = false;
    if (title.length < 3) { titleF.setError(fieldErrorText(title ? 'too_short' : 'required')); bad = true; }
    else if ([...title].length > 120) { titleF.setError(fieldErrorText('too_long', { max: 120 })); bad = true; }
    if (desc.length < 10) { descF.setError(fieldErrorText(desc ? 'too_short' : 'required')); bad = true; }
    else if ([...desc].length > 4000) { descF.setError(fieldErrorText('too_long', { max: 4000 })); bad = true; }
    if (bad) { (title.length < 3 ? titleF.input : descF.input).focus(); return; }

    const fd = new FormData();
    fd.append('type', form.querySelector('input[name="rtype"]:checked').value);
    fd.append('area', form.querySelector('input[name="rarea"]:checked').value);
    fd.append('title', title);
    fd.append('description', desc);
    fd.append('page', pageF.input.value.trim());
    fd.append('context', JSON.stringify(context));
    if (shot) fd.append('screenshot', shot, shot.name);
    setBusy(sendBtn, true, t('report.sending'));
    try {
      const r = await upload('/reports', fd);
      reportId = r.data.report.id;
      showResult(r.data.delivered);
    } catch (err) {
      setBusy(sendBtn, false);
      if (err.code === 'duplicate_report') { status.append(alertBox('info', null, t('report.duplicate'))); return; }
      if (err.code === 'validation') {
        const f = err.fields || {};
        if (f.title) titleF.setError(fieldErrorText(f.title, { max: 120 }));
        if (f.description) descF.setError(fieldErrorText(f.description, { max: 4000 }));
        if (f.page) pageF.setError(fieldErrorText(f.page, { max: 300 }));
        if (f.file) { shotErr.textContent = fieldErrorText(f.file, { max: '5 MB', formats: 'JPG, PNG, WebP', w: 16, h: 16 }); shotErr.hidden = false; }
        status.append(alertBox('bad', null, t('errors.validation')));
        return;
      }
      // Nothing typed is lost: the dialog stays open with the text in place.
      status.append(alertBox('bad', null, errorText(err, { preserved: true })));
    }
  });
}
