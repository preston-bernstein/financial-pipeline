export const CATEGORIES = [
  'groceries',
  'restaurants',
  'transportation',
  'utilities',
  'healthcare',
  'entertainment',
  'shopping',
  'housing',
  'subscriptions',
  'travel',
  'transfers',
  'income',
  'education',
  'personal_care',
  'other',
] as const;

export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LIST = CATEGORIES.join(', ');

export function isValidCategory(s: string): s is Category {
  return (CATEGORIES as readonly string[]).includes(s);
}
