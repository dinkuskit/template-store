export type ProfileAddressDraft = {
  name: string; line1: string; line2: string; city: string;
  region: string; postalCode: string; country: string;
};
export type ProfileAddressError = {
  field: 'name' | 'line1' | 'city' | 'postal-code' | 'country'; message: string;
};

/** Preserve the existing optional-address rule; this does not validate geography. */
export function profileAddressError(draft: ProfileAddressDraft): ProfileAddressError | null {
  const present = (value: string) => Boolean(value.trim());
  if (![draft.name, draft.line1, draft.line2, draft.city, draft.region, draft.postalCode].some(present)) return null;
  const fields: [ProfileAddressError['field'], string, string][] = [
    ['name', draft.name, 'Enter the recipient name.'],
    ['line1', draft.line1, 'Enter address line 1.'],
    ['city', draft.city, 'Enter the city.'],
    ['postal-code', draft.postalCode, 'Enter the postal code.'],
    ['country', draft.country, 'Choose a country.'],
  ];
  const missing = fields.find(([, value]) => !present(value));
  return missing ? { field: missing[0], message: missing[2] } : null;
}

/** Remove only this field's correction, preserving unrelated description tokens. */
export function clearProfileFeedback(root: Element, edited?: Element): void {
  for (const feedback of root.querySelectorAll<HTMLElement>('[data-account-profile-error]')) {
    const name = feedback.getAttribute('data-account-profile-error');
    const field = root.querySelector(`[data-account-profile-${name}]`);
    if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement) || (edited && edited !== field) || feedback.hidden) continue;
    feedback.hidden = true;
    feedback.textContent = '';
    field.removeAttribute('aria-invalid');
    const descriptions = (field.getAttribute('aria-describedby') ?? '').split(/\s+/u).filter(id => id && id !== feedback.id);
    if (descriptions.length) field.setAttribute('aria-describedby', descriptions.join(' '));
    else field.removeAttribute('aria-describedby');
  }
}

/** Only a rejected explicit Save moves focus; typing never jumps to another field. */
export function showProfileFeedback(root: Element, error: ProfileAddressError): void {
  clearProfileFeedback(root);
  const feedback = root.querySelector(`[data-account-profile-error="${error.field}"]`);
  const field = root.querySelector(`[data-account-profile-${error.field}]`);
  if (!(feedback instanceof HTMLElement) || !feedback.id || !(field instanceof HTMLInputElement || field instanceof HTMLSelectElement)) return;
  feedback.textContent = error.message;
  feedback.hidden = false;
  field.setAttribute('aria-invalid', 'true');
  const descriptions = new Set((field.getAttribute('aria-describedby') ?? '').split(/\s+/u).filter(Boolean));
  descriptions.add(feedback.id);
  field.setAttribute('aria-describedby', [...descriptions].join(' '));
  field.focus();
  field.scrollIntoView({ block: 'center', behavior: 'instant' });
}
