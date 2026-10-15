import { CategoryDto, TrackingType } from '@budgetracker/shared';
import { categoryLabel, categoryOptions, TRACKING_TYPE_LABELS } from './labels';

// Valide aussi R1 côté Angular : l'enum de @budgetracker/shared se résout et se bundle.
describe('TRACKING_TYPE_LABELS', () => {
  it('a un libellé pour chaque TrackingType du package shared', () => {
    expect(Object.keys(TRACKING_TYPE_LABELS).sort()).toEqual(Object.values(TrackingType).sort());
    expect(TRACKING_TYPE_LABELS[TrackingType.NOT_TRACKED]).toBe('Non suivi (portefeuille)');
  });
});

describe('catégories', () => {
  const cat = (id: string, over: Partial<CategoryDto> = {}): CategoryDto => ({
    id, parentId: null, system: true, nameKey: null, name: null, color: null, hidden: false, customName: null, ...over,
  });

  it('libellé : nom personnalisé, sinon nom perso, sinon traduction', () => {
    expect(categoryLabel(cat('1', { nameKey: 'housing', customName: 'Maison' }))).toBe('Maison');
    expect(categoryLabel(cat('2', { nameKey: 'housing' }))).toBe('Logement');
    expect(categoryLabel(cat('3', { system: false, name: 'Vélo' }))).toBe('Vélo');
  });

  it('listes de saisie : sans les catégories masquées ni techniques', () => {
    const all = [cat('1', { nameKey: 'sport', hidden: true }), cat('2', { nameKey: 'housing' }), cat('3', { nameKey: 'transfer' }), cat('4', { nameKey: 'sport.license', parentId: '1' })];
    expect(categoryOptions(all, null)).toEqual([{ id: '2', label: 'Logement' }]);
    expect(categoryOptions(all, '1')).toEqual([{ id: '4', label: 'Licence' }]);
  });
});
