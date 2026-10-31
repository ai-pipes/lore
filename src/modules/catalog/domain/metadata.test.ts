import { describe, expect, it } from 'vitest';
import { extractMetadata } from './metadata.js';

describe('extractMetadata', () => {
  it('finds DAL interfaces, tables, stored procedures, gRPC services, queues and HTTP services', () => {
    const content = [
      'Uses IOrderRepository and IPaymentDal.',
      'table: order_items',
      'SELECT * FROM refunds JOIN customers ON 1=1',
      'EXEC usp_CreateOrder',
      'see payments.proto and grpc://billing.internal/x',
      'queue: orders.created',
      'Calls https://api.stripe.com/v1 and http://localhost:3000',
      'service: inventory-api',
    ].join('\n');
    const m = extractMetadata(content);
    const has = (key: string, value: string) => m.some((e) => e.key === key && e.value === value);
    expect(has('dal_interface', 'IOrderRepository')).toBe(true);
    expect(has('dal_interface', 'IPaymentDal')).toBe(true);
    expect(has('table_name', 'order_items')).toBe(true);
    expect(has('table_name', 'refunds')).toBe(true);
    expect(has('table_name', 'customers')).toBe(true);
    expect(has('stored_proc', 'usp_createorder')).toBe(true);
    expect(has('grpc_service', 'payments')).toBe(true);
    expect(has('grpc_service', 'billing.internal')).toBe(true);
    expect(has('message_queue', 'orders.created')).toBe(true);
    expect(has('http_service', 'api.stripe.com')).toBe(true);
    expect(m.some((e) => e.value.startsWith('localhost'))).toBe(false);
    expect(has('http_service', 'inventory-api')).toBe(true);
  });

  it('deduplicates entries and skips SQL keywords and short names', () => {
    const m = extractMetadata('FROM orders FROM orders FROM ab JOIN select');
    expect(m.filter((e) => e.key === 'table_name')).toEqual([{ key: 'table_name', value: 'orders' }]);
  });

  it('returns nothing for plain prose', () => {
    expect(extractMetadata('Just a page about nothing in particular.')).toEqual([]);
  });

  it('does not turn ordinary prose into tables, gRPC services, queues or HTTP services', () => {
    const prose = [
      'Data comes from the warehouse. Join our team and read from its archive, from a mirror.',
      'From now on we use gRPC for internal calls; the grpc client retries.',
      'The queue is drained nightly. This topic covers retries. The exchange was renamed.',
      'Table: the one below. Service: docs are published on every merge.',
      'Topic: covers the whole flow. Queue: is optional. gRPC: for internal use only.',
    ].join('\n');
    expect(extractMetadata(prose)).toEqual([]);
  });

  it('reads SQL tables from code in any case, but only uppercase SQL keywords in prose', () => {
    const content = [
      'We read from orders in prose, which is not SQL.',
      '```sql',
      'select * from invoices join invoice_lines on true',
      '```',
      'and `delete from audit_log` inline.',
    ].join('\n');
    const tables = extractMetadata(content).filter((e) => e.key === 'table_name').map((e) => e.value);
    expect(tables).toEqual(['invoices', 'invoice_lines', 'audit_log']);
  });

  it('keeps explicit keyword forms with quoted or identifier-like values', () => {
    const content = [
      'gRPC service: PaymentService',
      'grpc: ledger-api',
      'topic: `petstore.order-events`.',
      'Publishes to the queue `notifications.dead-letter`.',
      'table: pets)',
      'service: payments-gateway.',
      'Calls http://10.0.0.5:8080/x (queue: billing.retry)',
    ].join('\n');
    const m = extractMetadata(content);
    const has = (key: string, value: string) => m.some((e) => e.key === key && e.value === value);
    expect(has('grpc_service', 'PaymentService')).toBe(true);
    expect(has('grpc_service', 'ledger-api')).toBe(true);
    expect(has('message_queue', 'petstore.order-events')).toBe(true);
    expect(has('message_queue', 'notifications.dead-letter')).toBe(true);
    expect(has('table_name', 'pets')).toBe(true);
    expect(has('http_service', 'payments-gateway')).toBe(true);
    expect(has('http_service', '10.0.0.5')).toBe(true);
    expect(has('message_queue', 'billing.retry')).toBe(true);
    expect(m.some((e) => /[.)]$/.test(e.value))).toBe(false);
  });

  describe('pathological input', () => {
    const fast = (content: string) => {
      const started = performance.now();
      const m = extractMetadata(content);
      expect(performance.now() - started).toBeLessThan(200);
      return m;
    };

    it('trims a long run of punctuation inside a value in linear time', () => {
      fast(`queue: a${'.:;'.repeat(70_000)}x\ntopic: b${'.:;'.repeat(70_000)}`);
    });

    it('scans many unterminated code fences in linear time', () => {
      fast('```\nFROM\n'.repeat(50_000));
      fast('```x\n'.repeat(50_000));
      fast('text ```x'.repeat(50_000));
    });

    it('scans many backticks in linear time', () => {
      fast('`'.repeat(50_000));
      fast('`a'.repeat(50_000));
      fast('`\n'.repeat(50_000));
    });

    it('reads only the first 512 KB of a document', () => {
      expect(fast(`${'x '.repeat(300_000)}\ntable: late_table`)).toEqual([]);
    });

    it('ignores values longer than an identifier can be', () => {
      expect(extractMetadata(`table: ${'a'.repeat(300)}`)).toEqual([]);
    });
  });
});

