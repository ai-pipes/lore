import 'dotenv/config';
// Usage: npx tsx scripts/test-search-pipeline.ts "question" [library-a,library-b]
// Runs the search pipeline step by step (LLM term extraction, then hybrid search).
import { initDb } from '../src/platform/db.js';
import { createLanguageModel } from '../src/modules/llm/index.js';
import { initEmbeddings } from '../src/modules/catalog/infrastructure/embeddings/EmbeddingProvider.js';
import { createPgCatalog } from '../src/modules/catalog/index.js';
import { createSearch, searchDocuments, extractSearchTerms } from '../src/modules/search/index.js';

const QUERY = process.argv[2] ?? 'how are refunds handled when a payment fails?';
const SERVICES = process.argv[3] ? process.argv[3].split(',') : undefined;

async function run() {
  await initDb();
  initEmbeddings();
  const llm = createLanguageModel();
  const search = createSearch(createPgCatalog({ llm }), llm);

  console.log('═══════════════════════════════════════');
  console.log('QUERY    :', QUERY);
  console.log('SERVICES :', SERVICES ?? '(all — cross-library)');
  console.log('═══════════════════════════════════════\n');

  // Step 1: LLM keyword extraction
  console.log('── Step 1: LLM keyword extraction ─────');
  const t0 = Date.now();
  const searchTerms = await extractSearchTerms(search, QUERY);
  console.log('LLM output  :', searchTerms);
  console.log('Time        :', Date.now() - t0, 'ms\n');

  // Step 2: full pipeline
  console.log('── Step 2: search ──────────────────────');
  const t1 = Date.now();
  const services = SERVICES?.map((id) => ({ library_id: id }));
  const results = await searchDocuments(search, QUERY, { services });
  console.log('Time        :', Date.now() - t1, 'ms');
  console.log('Results     :', results.length, '\n');

  if (results.length === 0) {
    console.log('(no results)');
  } else {
    results.forEach((r, i) => {
      console.log(`[${i + 1}] ${r.library_id}.${r.slug}`);
      console.log(`    score      : ${r.score.toFixed(6)}`);
      console.log(`    entry_type : ${r.entry_type ?? '—'}`);
      console.log(`    summary    : ${r.summary ?? '—'}`);
    });
  }
}

run().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
