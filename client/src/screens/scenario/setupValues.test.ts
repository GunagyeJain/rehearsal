import { describe, expect, it } from 'vitest';
import type { UserInputField } from '@rehearsal/shared';
import { initialSetupValues } from './setupValues';

const fieldInput = { key: 'field', label: 'Field', type: 'text', required: true } as UserInputField;
const roleInput = { key: 'role', label: 'Role', type: 'text', required: true } as UserInputField;

describe('initialSetupValues', () => {
  it('prefills a field input from the onboarding profile', () => {
    expect(initialSetupValues([fieldInput], {}, ' Computer engineering ')).toEqual({ field: 'Computer engineering' });
  });

  it('keeps a saved answer over the profile', () => {
    expect(initialSetupValues([fieldInput], { field: 'Law' }, 'Computer engineering')).toEqual({ field: 'Law' });
  });

  it('leaves scenarios without a field input alone', () => {
    expect(initialSetupValues([roleInput], {}, 'Computer engineering')).toEqual({});
  });

  it('does nothing without a profile field', () => {
    expect(initialSetupValues([fieldInput], {}, undefined)).toEqual({});
    expect(initialSetupValues([fieldInput], {}, '  ')).toEqual({});
  });
});
