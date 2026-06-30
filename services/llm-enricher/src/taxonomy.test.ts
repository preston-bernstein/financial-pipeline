import { describe, it, expect } from 'vitest';
import { CATEGORIES, isValidCategory, CATEGORY_LIST } from './taxonomy.js';

describe('taxonomy', () => {
  it('has 15 categories', () => {
    expect(CATEGORIES).toHaveLength(15);
  });

  it('includes expected categories', () => {
    expect(CATEGORIES).toContain('groceries');
    expect(CATEGORIES).toContain('restaurants');
    expect(CATEGORIES).toContain('income');
    expect(CATEGORIES).toContain('transfers');
    expect(CATEGORIES).toContain('other');
  });

  it('isValidCategory accepts valid categories', () => {
    for (const cat of CATEGORIES) {
      expect(isValidCategory(cat)).toBe(true);
    }
  });

  it('isValidCategory rejects invalid categories', () => {
    expect(isValidCategory('food')).toBe(false);
    expect(isValidCategory('GROCERIES')).toBe(false);
    expect(isValidCategory('')).toBe(false);
    expect(isValidCategory('medical')).toBe(false);
  });

  it('CATEGORY_LIST is comma-separated', () => {
    const cats = CATEGORY_LIST.split(', ');
    expect(cats).toHaveLength(CATEGORIES.length);
    expect(cats).toContain('groceries');
  });
});
