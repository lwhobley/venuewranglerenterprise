import type { InventoryDomain } from '@prisma/client';

/**
 * The system taxonomy the brief requires. Seeded per facility on first use and
 * on legacy migration; operators may add custom categories beside these, and
 * system categories can be deactivated but not renamed away.
 */
export const SYSTEM_CATEGORIES: Record<'food' | 'beverage' | 'equipment', string[]> = {
  food: [
    'Proteins', 'Produce', 'Dairy & Eggs', 'Bakery & Breads', 'Dry Goods & Pantry', 'Frozen',
    'Prepared Foods', 'Sauces, Condiments & Spices', 'Desserts', 'Garnishes', 'Packaging & Disposables',
    'Non-Alcoholic Mixers and Beverage Ingredients',
  ],
  // Alcohol is organised by drink type, never one undifferentiated list.
  beverage: [
    'Beer', 'Wine', 'Sparkling Wine & Champagne', 'Vodka', 'Tequila & Mezcal', 'Whiskey & Bourbon', 'Rum',
    'Gin', 'Cognac & Brandy', 'Liqueurs & Cordials', 'Ready-to-Drink / Canned Cocktails', 'Draft Beer / Kegs',
    'Cocktail Mixers', 'Non-Alcoholic Beverage', 'Coffee & Tea', 'Juice', 'Water', 'Energy Drinks',
  ],
  // Equipment is organised by operating department, not by what it is.
  equipment: [
    'Catering & Banquets', 'Concessions', 'Premium Suites', 'Clubs & Lounges', 'Bars', 'Kitchen & Culinary',
    'Event Operations', 'Warehouse & Storage', 'Front of House', 'Guest Services', 'Technology & POS Hardware',
    'Security & Safety', 'Maintenance & Facilities',
  ],
};

export function slugify(name: string): string {
  return name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function normalizeItemName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Where a legacy BarStockCategory lands. Spirits carry no drink type in the old
 * model, so they default to the whiskey shelf only when the name says so and
 * otherwise to liqueurs, to be recategorised by the beverage manager.
 */
export function mapLegacyBarCategory(
  category: string,
  itemName: string,
): { domain: InventoryDomain; categorySlug: string | null } {
  const name = itemName.toLowerCase();
  switch (category) {
    case 'beer':
      return { domain: 'beverage', categorySlug: /keg|draft|draught/.test(name) ? 'draft-beer-kegs' : 'beer' };
    case 'wine':
      return {
        domain: 'beverage',
        categorySlug: /champagne|prosecco|cava|sparkling|brut/.test(name) ? 'sparkling-wine-and-champagne' : 'wine',
      };
    case 'mixer':
      return { domain: 'beverage', categorySlug: 'cocktail-mixers' };
    case 'spirit':
      return { domain: 'beverage', categorySlug: spiritSlug(name) };
    case 'garnish':
      return { domain: 'food', categorySlug: 'garnishes' };
    case 'protein':
      return { domain: 'food', categorySlug: 'proteins' };
    case 'produce':
      return { domain: 'food', categorySlug: 'produce' };
    case 'dairy':
      return { domain: 'food', categorySlug: 'dairy-and-eggs' };
    case 'dry_goods':
      return { domain: 'food', categorySlug: 'dry-goods-and-pantry' };
    case 'bakery':
      return { domain: 'food', categorySlug: 'bakery-and-breads' };
    case 'frozen':
      return { domain: 'food', categorySlug: 'frozen' };
    case 'supply':
      return { domain: 'packaging', categorySlug: null };
    default:
      return { domain: 'supply', categorySlug: null };
  }
}

function spiritSlug(name: string): string {
  if (/vodka/.test(name)) return 'vodka';
  if (/tequila|mezcal/.test(name)) return 'tequila-and-mezcal';
  if (/whisk|bourbon|scotch|rye/.test(name)) return 'whiskey-and-bourbon';
  if (/\brum\b/.test(name)) return 'rum';
  if (/\bgin\b/.test(name)) return 'gin';
  if (/cognac|brandy|armagnac/.test(name)) return 'cognac-and-brandy';
  return 'liqueurs-and-cordials';
}
