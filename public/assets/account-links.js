/* Staff identity controls belong to existing System Administrator User Management. */
window.MGAEMSAccountLinks = (() => {
  const esc = MGAEMS.escapeHTML;
  const label = value => String(value || '').replace(/_/g, ' ');
  const admin = () => MGAEMS.currentUser()?.role === 'system_admin';

  function status(account) {
    const link = account.account_link;
    if (!link) return '<span class="text-muted">Not loaded</span>';
    if (link.staff) return `<strong>Linked: ${esc(link.staff.name)}</strong><small>${esc(link.staff.status)} · ${esc(label(link.staff.staff_type))}</small>${link.required && !link.eligible ? `<small class="text-muted">${esc(link.reason)}</small>` : ''}`;
    return `<span class="text-muted">${link.required ? 'Unlinked — Staff access unavailable' : 'Staff membership not required'}</span>`;
  }

  async function open(userId, onSaved = () => {}) {
    if (!admin() || !Number.isSafeInteger(Number(userId)) || Number(userId) < 1) return;
    const modal = MGAEMS.openModal({ title: 'Manage Staff account link', body: MGAEMS.loadingHTML('Loading verified account and Staff options…') });
    let context = null, sequence = 0, search = '', page = 1, selected = null, pending = false, needsReload = false;

    async function load() {
      const request = ++sequence;
      selected = null;
      needsReload = false;
      modal.body.innerHTML = MGAEMS.loadingHTML('Loading current account and Staff identities…');
      const params = new URLSearchParams({ page: String(page) });
      if (search) params.set('search', search);
      const result = await MGAEMS.get(`/api/v1/users/${Number(userId)}/staff-link?${params}`);
      if (modal.closed || request !== sequence) return;
      if (!result.ok) {
        context = null;
        modal.body.innerHTML = MGAEMS.errorHTML(result.status === 403 ? 'Only a System Administrator can manage account links.' : result.error);
        return;
      }
      context = result.data;
      if (Number(context.user.id) !== Number(userId)) {
        context = null;
        modal.body.innerHTML = MGAEMS.errorHTML('The account identity differs. Close and reopen it from User Management.');
        return;
      }
      render();
    }

    function render() {
      const account = context.user, current = context.account_link.staff;
      modal.body.innerHTML = `<form id="staffLinkForm">
        <div data-form-error role="alert" tabindex="-1"></div>
        <dl class="admin-detail-grid"><div><dt>Account</dt><dd>${esc(account.username)}</dd></div><div><dt>Role / status</dt><dd>${esc(label(account.role))} · ${esc(account.status)}</dd></div><div><dt>Current Staff link</dt><dd>${current ? esc(current.name) + ' · ' + esc(current.status) : 'Unlinked'}</dd></div><div><dt>Employment eligibility</dt><dd>${context.account_link.required ? esc(context.account_link.reason || 'Eligible active Staff') : 'Staff membership is optional for System Administrator; portal roles do not use this workflow.'}</dd></div></dl>
        <p class="admin-user-note">Verify the person’s identity and current employment with the school before confirming. Names and role titles do not establish identity. A relationship change signs the affected account out on all devices.</p>
        ${current ? '<p>To replace this relationship, first remove the existing link after verification, then review and confirm the new identity separately.</p>' : `<div class="admin-toolbar"><div class="field"><label for="staffLinkSearch">Find existing Staff</label><input id="staffLinkSearch" type="search" maxlength="100" value="${esc(search)}" placeholder="Search Staff names"></div><button type="button" class="btn btn-secondary" id="staffLinkFind">Find Staff</button></div>
        <div class="field"><label for="staffLinkChoice">Verified Staff identity</label><select id="staffLinkChoice" name="staff_id" ${context.can_link ? 'required' : 'disabled'}><option value="">Choose a Staff identity after verification…</option>${context.staff_options.map(staff => `<option value="${esc(staff.id)}" ${staff.eligible ? '' : 'disabled'}>${esc(staff.name)} · ${esc(label(staff.staff_type))} · ${esc(staff.role_title || '')} · ${esc(staff.status)}${staff.reason ? ' — ' + esc(staff.reason) : ''}</option>`).join('')}</select></div>
        <div class="admin-pagination"><span>Page ${context.meta.page} · ${context.meta.total} Staff records</span><div class="controls"><button type="button" class="btn btn-secondary btn-sm" id="staffLinkPrev" ${page <= 1 ? 'disabled' : ''}>Previous</button><button type="button" class="btn btn-secondary btn-sm" id="staffLinkNext" ${page * context.meta.per_page >= context.meta.total ? 'disabled' : ''}>Next</button></div></div>`}
        <div class="field"><label for="staffLinkConfirmed" class="admin-link-confirm"><input type="checkbox" id="staffLinkConfirmed" name="identity_confirmed" required> I verified this person’s identity and the intended account relationship.</label></div>
        <div class="admin-link-actions"><button type="button" class="btn btn-secondary" data-link-cancel>Cancel</button><button type="button" class="btn btn-secondary" id="staffLinkReload" hidden>Reload current identities</button><button type="submit" class="btn ${current ? 'btn-danger' : 'btn-primary'}" id="staffLinkSave" ${current || context.can_link ? '' : 'disabled'}>${current ? 'Remove Staff link' : 'Confirm Staff link'}</button></div>
      </form>`;
      const form = modal.body.querySelector('#staffLinkForm');
      modal.body.querySelector(current ? '#staffLinkConfirmed' : '#staffLinkSearch').focus();
      modal.body.querySelector('[data-link-cancel]').addEventListener('click', () => modal.close());
      modal.body.querySelector('#staffLinkReload').addEventListener('click', load);
      if (!current) {
        modal.body.querySelector('#staffLinkChoice').addEventListener('change', event => { selected = context.staff_options.find(staff => String(staff.id) === event.target.value && staff.eligible) || null; });
        modal.body.querySelector('#staffLinkFind').addEventListener('click', () => { search = modal.body.querySelector('#staffLinkSearch').value.trim(); page = 1; load(); });
        modal.body.querySelector('#staffLinkPrev').addEventListener('click', () => { page--; load(); });
        modal.body.querySelector('#staffLinkNext').addEventListener('click', () => { page++; load(); });
      }
      form.addEventListener('submit', async event => {
        event.preventDefault();
        if (pending || needsReload) return;
        if (!modal.body.querySelector('#staffLinkConfirmed').checked || (!current && (!context.can_link || !selected))) {
          MGAEMS.showFormErrors(form, { error: 'Select an eligible existing identity and confirm the human verification.' });
          return;
        }
        const identity = current || selected;
        const expectedVersion = context.account_link.version;
        pending = true;
        const confirmed = await MGAEMS.confirmAction(current ? 'Remove Staff account link?' : 'Link this Staff identity?', `${account.username} (${label(account.role)}) ${current ? 'will no longer be linked to' : 'will be linked to'} ${identity.name} (Staff #${identity.id}). Confirm only after verifying the person. All affected sessions and tokens will be invalidated.`, current ? 'Remove verified link' : 'Link verified identity');
        if (!confirmed || modal.closed) { pending = false; return; }
        modal.setBusy(true);
        const result = await MGAEMS.patch(`/api/v1/users/${account.id}/staff-link`, {
          staff_id: current ? null : identity.id,
          expected_staff_id: current?.id ?? null,
          expected_session_version: expectedVersion,
          staff_revision: identity.revision,
          identity_confirmed: true,
        });
        modal.setBusy(false);
        pending = false;
        if (!result.ok) {
          if ([401, 403].includes(result.status)) {
            context = null;
            selected = null;
            modal.body.innerHTML = MGAEMS.errorHTML('Account-link management is no longer authorized. Close this dialog and sign in again.');
            return;
          }
          MGAEMS.showFormErrors(form, result);
          if (result.status === 409) {
            needsReload = true;
            modal.body.querySelector('#staffLinkSave').disabled = true;
            modal.body.querySelector('#staffLinkReload').hidden = false;
          }
          return;
        }
        modal.close();
        MGAEMS.toast('Staff account relationship saved. The affected account must sign in again.', 'success');
        if (String(MGAEMS.currentUser()?.id) === String(account.id)) MGAEMS.logout();
        else onSaved();
      });
    }

    await load();
  }

  return { status, open };
})();
