import { describe, expect, it } from 'vitest';
import { profileAddressError, type ProfileAddressDraft } from '../../src/features/shopper-account/profile-feedback.js';

const complete: ProfileAddressDraft = { name: 'Synthetic Shopper', line1: '1 Example Way', line2: '', city: 'Testville', region: '', postalCode: '12345', country: 'US' };

describe('optional shopper profile address corrections', () => {
  it.each([
    ['name', 'name', 'Enter the recipient name.'],
    ['line1', 'line1', 'Enter address line 1.'],
    ['city', 'city', 'Enter the city.'],
    ['postalCode', 'postal-code', 'Enter the postal code.'],
    ['country', 'country', 'Choose a country.'],
  ] as const)('locates the first missing %s without changing the draft', (key, field, message) => {
    const draft = { ...complete, [key]: '  ' };
    expect(profileAddressError(draft)).toEqual({ field, message });
    expect(draft).toEqual({ ...complete, [key]: '  ' });
  });

  it('uses form order when several required fields are missing', () => {
    expect(profileAddressError({ ...complete, name: '', line1: '', city: '' })?.field).toBe('name');
    expect(profileAddressError({ ...complete, line1: '', city: '' })?.field).toBe('line1');
  });

  it('keeps an entirely blank address optional, including phone-only or clear saves', () => {
    expect(profileAddressError({ name: '', line1: '', line2: '', city: '', region: '', postalCode: '', country: 'US' })).toBeNull();
  });

  it('does not invent region or geographic validation for saved profiles', () => {
    expect(profileAddressError(complete)).toBeNull();
    expect(profileAddressError({ ...complete, country: 'XX' })).toBeNull();
    expect(profileAddressError({ ...complete, name: '', line1: '', city: '', postalCode: '', line2: 'Room 2' })?.field).toBe('name');
  });

  it('preserves the previous required/optional acceptance rule for every field-presence combination', () => {
    const keys = ['name', 'line1', 'line2', 'city', 'region', 'postalCode', 'country'] as const;
    for (let bits = 0; bits < 128; bits++) {
      const draft = Object.fromEntries(keys.map((key, i) => [key, bits & (1 << i) ? 'value' : ''])) as ProfileAddressDraft;
      const hasAddress = Boolean(draft.name || draft.line1 || draft.line2 || draft.city || draft.region || draft.postalCode);
      const rejectedBefore = hasAddress && (!draft.name || !draft.line1 || !draft.city || !draft.postalCode || !draft.country);
      expect(Boolean(profileAddressError(draft)), String(bits)).toBe(rejectedBefore);
    }
  });
});
