export interface MetadataEntry {
  key: 'dal_interface' | 'table_name' | 'stored_proc' | 'grpc_service' | 'message_queue' | 'http_service';
  value: string;
}

/**
 * Words that follow "from", "table:", "topic:", "service:" and the like in ordinary prose. A value
 * equal to one of these is prose, not an identifier.
 */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'this', 'that', 'these', 'those', 'it', 'its', 'our', 'your', 'their', 'his', 'her',
  'my', 'we', 'you', 'they', 'he', 'she', 'one', 'some', 'any', 'all', 'each', 'every', 'other', 'another',
  'no', 'none', 'not', 'here', 'there', 'now', 'then', 'below', 'above', 'which', 'what', 'who', 'where',
  'when', 'how', 'why', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'has', 'have', 'had', 'do',
  'does', 'did', 'can', 'could', 'will', 'would', 'should', 'may', 'might', 'must', 'shall', 'for', 'to',
  'of', 'in', 'on', 'at', 'by', 'with', 'from', 'into', 'onto', 'as', 'and', 'or', 'but', 'if', 'so',
  'see', 'via', 'per', 'about', 'covers', 'cover', 'describes', 'describe', 'explains', 'explain',
  'handles', 'handle', 'contains', 'contain', 'uses', 'use', 'used', 'shows', 'show', 'lists', 'list',
  'includes', 'include', 'provides', 'provide', 'returns', 'return', 'optional', 'required',
  'tbd', 'todo', 'docs', 'doc', 'documentation', 'page', 'pages', 'section', 'example', 'examples',
]);

const SQL_KEYWORDS = /^(SELECT|WHERE|AND|OR|ON|AS|NULL|NOT|LATERAL|UNNEST|VALUES|DUAL)$/i;

/** Only this much of a document is scanned, so extraction stays cheap on huge pages. */
export const MAX_METADATA_SCAN_CHARS = 512 * 1024;
/** Longer values are not identifiers; they are rejected before any further matching. */
const MAX_VALUE_LENGTH = 256;

/** Looks like an identifier (not a sentence fragment), and is not a stopword. */
function isIdentifier(value: string): boolean {
  return value.length >= 2 && value.length <= MAX_VALUE_LENGTH
    && /^[A-Za-z0-9_][\w.\-:/]*$/.test(value) && /[A-Za-z_.]/.test(value)
    && !STOPWORDS.has(value.toLowerCase());
}

const TRAILING_PUNCTUATION = new Set(['.', ':', ';', ',', ')', '-', '/']);

/** Strips punctuation that ends a sentence or clause rather than the identifier (a linear scan from the end). */
function trimTrailing(value: string): string {
  let end = value.length;
  while (end > 0 && TRAILING_PUNCTUATION.has(value[end - 1])) end--;
  return value.slice(0, end);
}

/**
 * Splits Markdown into its code (fenced blocks and inline spans, in document order) and the
 * remaining prose. A line-by-line scan: a line starting with ``` opens or closes a fence, and an
 * unterminated fence runs to the end of the document (as in CommonMark).
 */
function splitCode(content: string): { code: string[]; prose: string } {
  const code: string[] = [];
  const prose: string[] = [];
  let fence: string[] | null = null;
  for (const line of content.split('\n')) {
    if (line.startsWith('```')) {
      if (fence) {
        code.push(fence.join('\n'));
        fence = null;
      } else {
        fence = [];
      }
      prose.push('');
    } else if (fence) {
      fence.push(line);
      prose.push('');
    } else {
      // Inline spans: `[^`]+` stops at the next backtick, so each attempt is bounded by the span.
      prose.push(line.replace(/`([^`]+)`/g, (_m, span: string) => {
        code.push(span);
        return ' ';
      }));
    }
  }
  if (fence) code.push(fence.join('\n'));
  return { code, prose: prose.join('\n') };
}

const SQL_TABLE_SOURCE = String.raw`\b(?:FROM|JOIN)\s+[\x60"[]?(\w+)`;

export function extractMetadata(document: string): MetadataEntry[] {
  const content = document.length > MAX_METADATA_SCAN_CHARS ? document.slice(0, MAX_METADATA_SCAN_CHARS) : document;
  const results: MetadataEntry[] = [];
  const seen = new Set<string>();

  function add(key: MetadataEntry['key'], raw: string): void {
    const value = trimTrailing(raw);
    if (!isIdentifier(value)) return;
    const dedupeKey = `${key}:${value}`;
    if (!seen.has(dedupeKey)) {
      seen.add(dedupeKey);
      results.push({ key, value });
    }
  }

  // DAL interfaces: IXxxDal, IXxxRepository, IXxxStore
  for (const m of content.matchAll(/\bI[A-Z]\w+(?:Dal|Repository|Store|Repo)\b/g)) {
    add('dal_interface', m[0]);
  }

  // Table names: explicit "table: foo_bar" or "table_name: foo_bar"
  for (const m of content.matchAll(/\btable(?:_name)?:\s*([`"']?)(\w+)\1/gi)) {
    add('table_name', m[2]);
  }

  // Table names from SQL FROM/JOIN clauses: any case inside code, but only uppercase SQL in prose
  // (a lowercase "from" or "join" in prose is English, not SQL).
  const { code, prose } = splitCode(content);
  const sqlTables = (text: string, flags: string) => {
    for (const m of text.matchAll(new RegExp(SQL_TABLE_SOURCE, flags))) {
      const name = m[1];
      if (name.length > 2 && !SQL_KEYWORDS.test(name)) add('table_name', name);
    }
  };
  for (const block of code) sqlTables(block, 'gi');
  sqlTables(prose, 'g');

  // Stored procedures: sp_xxx, usp_xxx, proc_xxx
  for (const m of content.matchAll(/\b(?:usp?|proc)_\w+/gi)) {
    add('stored_proc', m[0].toLowerCase());
  }

  // gRPC services: .proto files, grpc:// URLs, and explicit "grpc:" / "gRPC service:" declarations
  for (const m of content.matchAll(/\b(\w+)\.proto\b/gi)) {
    add('grpc_service', m[1]);
  }
  for (const m of content.matchAll(/grpc:\/\/([^/\s]+)/gi)) {
    add('grpc_service', m[1]);
  }
  for (const m of content.matchAll(/\bgrpc(?:[ _-]service)?:[ \t]*([`"']?)([A-Za-z][\w.-]*)\1/gi)) {
    add('grpc_service', m[2]);
  }

  // Message queues: "queue: x", "topic: x", "exchange: x", or the keyword followed by a quoted name
  for (const m of content.matchAll(/\b(?:queue|topic|exchange):[ \t]*([`"']?)([^\s`"',]+)\1/gi)) {
    add('message_queue', m[2]);
  }
  for (const m of content.matchAll(/\b(?:queue|topic|exchange)\s+([`"'])([a-z][\w.\-:]+)\1/gi)) {
    add('message_queue', m[2]);
  }

  // External HTTP services: http(s):// excluding localhost
  for (const m of content.matchAll(/https?:\/\/(?!localhost)([a-z0-9][\w.-]+)/gi)) {
    add('http_service', m[1]);
  }
  // "service:" explicit declarations
  for (const m of content.matchAll(/\bservice:[ \t]*([`"']?)([a-zA-Z][\w-]+)\1/gi)) {
    add('http_service', m[2]);
  }

  return results;
}
