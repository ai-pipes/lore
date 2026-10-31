import { describe, expect, it } from 'vitest';
import { createFakeCatalog } from '../../../../test/fakes/catalog.js';
import { createLanguageModel } from '../../llm/index.js';
import { createSearch } from './compose.js';

const model = createLanguageModel({});

describe('createSearch', () => {
  it('takes the drop factor from LORE_SEARCH_DROP_FACTOR, leaving it unset otherwise', () => {
    const { deps } = createFakeCatalog();
    expect(createSearch(deps, model, { LORE_SEARCH_DROP_FACTOR: '0.5' }).dropFactor).toBe(0.5);
    expect(createSearch(deps, model, {}).dropFactor).toBeUndefined();
    expect(createSearch(deps, model, { LORE_SEARCH_DROP_FACTOR: 'x' }).dropFactor).toBeUndefined();
  });
});
