import { describe, it, expect } from 'vitest';
import { errFields } from './err-fields.js';

describe('errFields', () => {
  it('extracts type and message from a real Error', () => {
    expect(errFields(new TypeError('bad input'))).toEqual({ err_type: 'TypeError', err_msg: 'bad input' });
  });

  it('falls back to UnknownError for a non-Error throw', () => {
    expect(errFields('a plain string throw')).toEqual({ err_type: 'UnknownError', err_msg: 'a plain string throw' });
  });

  it('never includes a stack trace', () => {
    const fields = errFields(new Error('boom'));
    expect(JSON.stringify(fields)).not.toContain('at ');
    expect(Object.keys(fields)).toEqual(['err_type', 'err_msg']);
  });
});
