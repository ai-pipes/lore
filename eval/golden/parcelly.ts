import type { GoldenQuestion } from '../lib/golden.js';

// The Parcelly golden set, asked against the showcase stack seeded by examples/showcase/push.sh.
// Current content: v2 for orders-service, billing-service and notifications-service; v1 for the other
// libraries; dispatch-service branch `feature/batch-dispatch` is pushed but not promoted.
// Each question names the document line (examples/showcase/<dir>/<library>/<slug>.md:<line>) its facts come from.

// No digit, dot or comma right before a number, so "25 km" never satisfies km('5').
const NB = '(?<![\\d.,])';

/** An EUR amount such as "3.50": 3.50 EUR, 3,50 €, €3.50, EUR 3.50, 3.50 euro, 3,50 евро. */
function eur(amount: string): RegExp[] {
  const [int, dec] = amount.split('.');
  const num = `${NB}${int}[.,]${dec}(?!\\d)`;
  return [
    new RegExp(`${num}\\s*(?:EUR|€|euros?|евро)`, 'i'),
    new RegExp(`(?:EUR|€)\\s*${num}`, 'i'),
  ];
}
/** 10 min, 10 minutes, 10-minute, 10 Minuten, 10 минут. */
function minutes(n: string): RegExp {
  return new RegExp(`${NB}${n}[\\s-]*(?:minutes?|mins?\\b|minuten|мин)`, 'i');
}
/** 45 s, 45s, 45 seconds, 45-second, 45 sec. */
function seconds(n: string): RegExp {
  return new RegExp(`${NB}${n}[\\s-]*(?:seconds?|secs?\\b|s\\b|sekunden|сек)`, 'i');
}
function km(n: string): RegExp {
  return new RegExp(`${NB}${n}[\\s-]*(?:km\\b|kilomet|км)`, 'i');
}
/**
 * Method and path on one line, in either order and at most 40 characters apart: "POST /api/v1/auth/refresh",
 * "a POST to https://host/api/v1/auth/refresh", "`/api/v1/auth/refresh` (POST)". The method is matched upper-case
 * only, so the verb "get" in prose does not count as GET. Placeholders may be {order_id}, :orderId or <order_id>.
 */
function route(method: string, path: string): RegExp {
  const placeholder = '(?:\\{[^}\\s]+\\}|:\\w+|<[^>\\s]+>)';
  const body = path
    .split(/\{[^}]+\}/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'))
    .join(placeholder);
  const m = `\\b${method}\\b`;
  const p = `${body}(?![\\w-])`;
  return new RegExp(`${m}[^\\n]{0,40}?${p}|${p}[^\\n]{0,40}?${m}`);
}
/** An event name written as order.created, order_created or "order created". */
function event(name: string): RegExp {
  const [a, b] = name.split('.');
  return new RegExp(`${a}[._ ]${b}`, 'i');
}

const NO_DOCS = {
  id: 'no-docs',
  patterns: [
    /I don['’]t have documentation|No documentation found|нет документации/i,
    /could(n['’]t| not) find|no information|(not|isn['’]t|is not) documented|not covered/i,
    /нет информации|не наш[её]л|не описан/i,
  ],
};
// An insurance claim: an insurance word and a EUR amount in the same clause, so an honest refusal that mentions
// other amounts (delivery price, tip, fee) in another clause does not count.
const INSURED_AMOUNT = {
  id: 'insured-amount',
  patterns: [
    /(insur|insured|cover(s|ed|age)?|compensat|liab)[^\n.,;!?]{0,40}?(\d+([.,]\d+)?\s*(EUR|€)|(EUR|€)\s*\d)/i,
    /(\d+([.,]\d+)?\s*(EUR|€)|(EUR|€)\s*\d+([.,]\d+)?)[^\n.,;:!?]{0,40}?(insur|cover(age)?\b|per parcel)/i,
  ],
};
// A salary claim: a pay word and a EUR amount in the same clause (no , . ; : ! ? or newline between them), so an
// honest refusal that also mentions the 3.50 EUR fee or tips in another clause does not count.
const SALARY_AMOUNT = {
  id: 'salary-amount',
  patterns: [
    /(salar|wage|hourly|per hour|monthly|\bpay(s|ment)?\b)[^\n.,;:!?]{0,40}?(\d+([.,]\d+)?\s*(EUR|€)|(EUR|€)\s*\d)/i,
    /(\d+([.,]\d+)?\s*(EUR|€)|(EUR|€)\s*\d+([.,]\d+)?)[^\n.,;:!?]{0,40}?(salar|wage|per hour|hourly|a month|per month|monthly)/i,
  ],
};

export const PARCELLY: GoldenQuestion[] = [
  // ---------------------------------------------------------------- fact
  {
    // v2/orders-service/orders/quote-delivery.md:46-49 (base_price 4.90, 0.80 × distance_km); orders/overview.md:87
    id: 'price-formula',
    tags: ['fact'],
    question: 'How is the delivery price calculated?',
    expected_docs: [
      { library_id: 'orders-service', slug: 'orders/quote-delivery', grade: 2 },
      { library_id: 'orders-service', slug: 'orders/overview', grade: 1 },
    ],
    required_facts: [
      { id: 'base', patterns: [...eur('4.90'), /base[^.\n]{0,40}4[.,]90/i] },
      { id: 'per-km', patterns: [...eur('0.80'), /0[.,]80[^.\n]{0,20}(\/|per|pro)\s*km/i] },
    ],
  },
  {
    // v2/orders-service/orders/quote-delivery.md:62-63 (free-count radius_km=3; fewer than 3 free couriers → 1.5)
    id: 'surge-rule',
    tags: ['fact'],
    question: 'When does surge pricing apply to a delivery and how big is the surcharge?',
    expected_docs: [
      { library_id: 'orders-service', slug: 'orders/quote-delivery', grade: 2 },
      { library_id: 'dispatch-service', slug: 'dispatch/overview', grade: 1 },
    ],
    required_facts: [
      { id: 'multiplier', patterns: [/(?<![\d.,])1[.,]5(?![\d])/] },
      { id: 'couriers', patterns: [/(fewer|less) than (3|three)\b/i, /(?<![\d.,])(3|three)\s+(free\s+)?couriers/i, /<\s*3\b/] },
      { id: 'radius', patterns: [km('3')] },
    ],
  },
  {
    // v2/orders-service/orders/quote-delivery.md:58 (weight_kg ≤ 20), :61 (over 25 km → 422)
    id: 'max-distance-weight',
    tags: ['fact'],
    question: 'What is the maximum delivery distance and the maximum parcel weight?',
    expected_docs: [{ library_id: 'orders-service', slug: 'orders/quote-delivery', grade: 2 }],
    required_facts: [
      { id: 'distance', patterns: [km('25')] },
      { id: 'weight', patterns: [/(?<![\d.,])20\s*(kg\b|kilogram|кг)/i, /weight[^.\n]{0,30}(≤|<=)\s*20(?![\d.,])/i] },
    ],
  },
  {
    // v1/dispatch-service/dispatch/assign-courier.md:44 (5 km), :45 (8 km, 2 min after search_started_at)
    id: 'search-radius',
    tags: ['fact'],
    question: 'How far around the pickup does dispatch search for a courier, and when does it widen the search?',
    expected_docs: [
      { library_id: 'dispatch-service', slug: 'dispatch/assign-courier', grade: 2 },
      { library_id: 'dispatch-service', slug: 'dispatch/overview', grade: 1 },
    ],
    required_facts: [
      { id: 'initial', patterns: [km('5')] },
      { id: 'expanded', patterns: [km('8')] },
      { id: 'after', patterns: [minutes('2'), seconds('120'), /two minutes/i] },
    ],
  },
  {
    // v1/dispatch-service/dispatch/assign-courier.md:46 (offer timeout 45 s), :47 (max offers 3)
    id: 'offer-timeout',
    tags: ['fact'],
    question: 'How long does a courier have to accept an offer, and how many offers are made before ops is alerted?',
    expected_docs: [
      { library_id: 'dispatch-service', slug: 'dispatch/assign-courier', grade: 2 },
      { library_id: 'dispatch-service', slug: 'dispatch/overview', grade: 1 },
    ],
    required_facts: [
      { id: 'timeout', patterns: [seconds('45')] },
      { id: 'max-offers', patterns: [/(?<![\d.,])(3|three)\s+offers/i, /offer_count\s*<\s*3/i, /(third|3rd)\s+(offer|rejection|decline)/i] },
    ],
  },
  {
    // v1/dispatch-service/jobs/reassign-stale-assignments.md:39 (last_progress_at < now() - 10 minutes)
    id: 'stale-reassignment',
    tags: ['fact'],
    question: 'When is a courier who accepted an order but does not move toward the pickup replaced automatically?',
    expected_docs: [
      { library_id: 'dispatch-service', slug: 'jobs/reassign-stale-assignments', grade: 2 },
      { library_id: 'dispatch-service', slug: 'dispatch/overview', grade: 1 },
    ],
    required_facts: [{ id: 'stale-after', patterns: [minutes('10')] }],
  },
  {
    // v1/identity-service/identity/overview.md:46-47, :72 (access 15 minutes, refresh 30 days); auth/sign-in.md:47,50
    id: 'token-lifetimes',
    tags: ['fact'],
    question: 'How long are access tokens and refresh tokens valid?',
    expected_docs: [
      { library_id: 'identity-service', slug: 'identity/overview', grade: 2 },
      { library_id: 'identity-service', slug: 'auth/sign-in', grade: 1 },
      { library_id: 'identity-service', slug: 'auth/refresh-token', grade: 1 },
    ],
    // auth/refresh-token states both lifetimes too (:41-44), so either document is a correct citation.
    must_cite: ['identity-service/identity/overview|identity-service/auth/refresh-token'],
    required_facts: [
      { id: 'access', patterns: [minutes('15'), /(?<![\d.,])900\s*(s\b|sec)/i] },
      { id: 'refresh', patterns: [/(?<![\d.,])30[\s-]*(days?|tage|дн)/i] },
    ],
  },
  {
    // v1/api-gateway/gateway/rate-limits.md:33 (user 60 req/min), :34 (anon-ip 600 req/min, anonymous quote)
    id: 'gateway-rate-limits',
    tags: ['fact'],
    question: 'What rate limits does the API gateway apply to signed-in users and to anonymous quote requests?',
    expected_docs: [{ library_id: 'api-gateway', slug: 'gateway/rate-limits', grade: 2 }],
    required_facts: [
      { id: 'user', patterns: [/(?<![\d.,])60\s*(req(uest)?s?)?\s*(\/|per|a|pro)\s*min/i] },
      { id: 'anon-ip', patterns: [/(?<![\d.,])600\s*(req(uest)?s?)?\s*(\/|per|a|pro)\s*min/i] },
    ],
  },
  // ---------------------------------------------------------------- endpoint
  {
    // v1/identity-service/auth/refresh-token.md:6-7 (POST /api/v1/auth/refresh)
    id: 'refresh-token-endpoint',
    tags: ['endpoint'],
    question: 'Which endpoint do I call to refresh an access token?',
    expected_docs: [{ library_id: 'identity-service', slug: 'auth/refresh-token', grade: 2 }],
    required_facts: [{ id: 'route', patterns: [route('POST', '/api/v1/auth/refresh')] }],
  },
  {
    // v2/orders-service/orders/quote-delivery.md:6-7 (POST /api/v1/orders/quote)
    id: 'quote-endpoint',
    tags: ['endpoint'],
    question: 'Which API call returns a price quote for a delivery?',
    expected_docs: [{ library_id: 'orders-service', slug: 'orders/quote-delivery', grade: 2 }],
    required_facts: [{ id: 'route', patterns: [route('POST', '/api/v1/orders/quote')] }],
  },
  {
    // v1/tracking-service/tracking/get-eta.md:6-7 (GET /api/v1/orders/{order_id}/eta)
    id: 'eta-endpoint',
    tags: ['endpoint'],
    question: 'Which endpoint returns the estimated delivery time of an order?',
    expected_docs: [{ library_id: 'tracking-service', slug: 'tracking/get-eta', grade: 2 }],
    required_facts: [{ id: 'route', patterns: [route('GET', '/api/v1/orders/{order_id}/eta')] }],
  },
  {
    // v1/tracking-service/tracking/live-stream.md:7 (route .../stream), :8 and :33 (WebSocket)
    id: 'live-tracking-transport',
    tags: ['endpoint'],
    question: 'How does the customer app receive live courier position updates?',
    expected_docs: [
      { library_id: 'tracking-service', slug: 'tracking/live-stream', grade: 2 },
      { library_id: 'tracking-service', slug: 'tracking/get-eta', grade: 1 },
    ],
    required_facts: [
      { id: 'websocket', patterns: [/web\s?-?socket/i] },
      { id: 'route', patterns: [/\/api\/v1\/orders\/(?:\{[^}\s]+\}|:\w+|<[^>\s]+>)\/stream/i] },
    ],
  },
  {
    // v1/dispatch-service/dispatch/reassign-courier.md:7 (route), :32 (role ops only)
    id: 'reassign-endpoint',
    tags: ['endpoint'],
    question: 'How can an ops agent replace the courier assigned to an order?',
    expected_docs: [
      { library_id: 'dispatch-service', slug: 'dispatch/reassign-courier', grade: 2 },
      { library_id: 'dispatch-service', slug: 'ops/no-couriers-available', grade: 1 },
    ],
    required_facts: [{ id: 'route', patterns: [route('POST', '/api/v1/dispatch/{order_id}/reassign')] }],
  },
  // ---------------------------------------------------------------- flow
  {
    // v2/orders-service/events/order-created.md:75 (billing: Paylane payment intent), :76 (notifications), :79 (not dispatch)
    id: 'order-created-consumers',
    tags: ['flow'],
    question: 'Which services consume the order.created event and what does each of them do with it?',
    expected_docs: [
      { library_id: 'orders-service', slug: 'events/order-created', grade: 2 },
      { library_id: 'billing-service', slug: 'payments/on-order-created', grade: 1 },
      { library_id: 'notifications-service', slug: 'notifications/on-order-created', grade: 1 },
    ],
    required_facts: [
      { id: 'billing', patterns: [/billing/i] },
      { id: 'payment-intent', patterns: [/payment[ _-]intent/i] },
      { id: 'notifications', patterns: [/notifications?[ -]service/i, /notifications\/on-order-created/i] },
    ],
  },
  {
    // v2/billing-service/billing/overview.md:76-90 (intent with manual capture → payment_intent.authorized webhook
    // → capture → payment.captured on parcelly.payment-events)
    id: 'payment-flow',
    tags: ['flow'],
    question: 'Walk me through the payment flow from order creation until the payment is captured.',
    expected_docs: [
      { library_id: 'billing-service', slug: 'billing/overview', grade: 2 },
      { library_id: 'billing-service', slug: 'payments/on-order-created', grade: 1 },
      { library_id: 'billing-service', slug: 'payments/psp-webhook', grade: 1 },
      { library_id: 'billing-service', slug: 'payments/capture-payment', grade: 1 },
    ],
    required_facts: [
      { id: 'intent', patterns: [/payment[ _-]intent/i] },
      { id: 'webhook', patterns: [/webhook/i] },
      { id: 'authorized', patterns: [/authori[sz]/i] },
      { id: 'captured-event', patterns: [event('payment.captured')] },
    ],
  },
  {
    // v2/orders-service/orders/cancel-order.md:79-81 (order.cancelled → billing on-order-cancelled → issue-refund →
    // refund.issued; dispatch on-order-cancelled releases the courier); events/order-cancelled.md:55-56
    id: 'cancel-event-chain',
    tags: ['flow'],
    question: 'What happens across the services when a customer cancels an order?',
    expected_docs: [
      { library_id: 'orders-service', slug: 'orders/cancel-order', grade: 2 },
      { library_id: 'orders-service', slug: 'events/order-cancelled', grade: 1 },
      { library_id: 'billing-service', slug: 'payments/on-order-cancelled', grade: 1 },
      { library_id: 'billing-service', slug: 'refunds/issue-refund', grade: 1 },
      { library_id: 'dispatch-service', slug: 'dispatch/on-order-cancelled', grade: 1 },
    ],
    required_facts: [
      { id: 'cancelled-event', patterns: [event('order.cancelled')] },
      { id: 'billing-refund', patterns: [/refund/i] },
      { id: 'refund-issued', patterns: [event('refund.issued')] },
      { id: 'dispatch-release', patterns: [/(releas\w*|free[sd]?|unassign\w*)\s+(the\s+)?(assigned\s+)?courier|courier\s+(is\s+)?(released|freed|unassigned)/i] },
    ],
    forbidden: [{ id: 'v1-fee', patterns: eur('3.00') }],
  },
  {
    // v1/dispatch-service/dispatch/on-payment-captured.md:26 (consumes payment.captured);
    // dispatch/assign-courier.md:44-46 (5 km, 45 s offers), :60 (courier.assigned to the outbox)
    id: 'courier-assignment-flow',
    tags: ['flow'],
    question: 'How does a courier get assigned to an order once the payment has been captured?',
    expected_docs: [
      { library_id: 'dispatch-service', slug: 'dispatch/on-payment-captured', grade: 2 },
      { library_id: 'dispatch-service', slug: 'dispatch/assign-courier', grade: 2 },
      { library_id: 'dispatch-service', slug: 'dispatch/overview', grade: 1 },
    ],
    required_facts: [
      { id: 'trigger', patterns: [event('payment.captured')] },
      { id: 'radius', patterns: [km('5')] },
      { id: 'offer-timeout', patterns: [seconds('45')] },
      { id: 'assigned-event', patterns: [event('courier.assigned')] },
    ],
  },
  {
    // v2/notifications-service/notifications/overview.md:54-57 (event → notification matrix)
    id: 'notification-triggers',
    tags: ['flow'],
    question: 'Which events make the notifications service send a message to the customer?',
    expected_docs: [{ library_id: 'notifications-service', slug: 'notifications/overview', grade: 2 }],
    required_facts: [
      { id: 'order-created', patterns: [event('order.created')] },
      { id: 'courier-assigned', patterns: [event('courier.assigned')] },
      { id: 'delivery-completed', patterns: [event('delivery.completed')] },
      { id: 'refund-issued', patterns: [event('refund.issued')] },
    ],
  },
  // ---------------------------------------------------------------- ops
  {
    // v2/orders-service/ops/stuck-orders.md:70 (orders.dead-letter), :72 (replay payment.captured via orders-admin)
    id: 'stuck-orders-runbook',
    tags: ['ops'],
    question: 'Orders are stuck in status created although billing shows the payment as captured. What should on-call do?',
    expected_docs: [{ library_id: 'orders-service', slug: 'ops/stuck-orders', grade: 2 }],
    required_facts: [
      { id: 'replay', patterns: [/replay/i] },
      { id: 'dead-letter', patterns: [/dead[ -]?letter/i] },
    ],
  },
  {
    // v1/dispatch-service/ops/no-couriers-available.md:67 (reassign with preferred_courier_id),
    // :68 (cancel as ops, free, if nobody within 20 minutes of the alert)
    id: 'no-couriers-runbook',
    tags: ['ops'],
    question: 'The DispatchNoCourier alert fired for an order. What should ops do?',
    expected_docs: [
      { library_id: 'dispatch-service', slug: 'ops/no-couriers-available', grade: 2 },
      { library_id: 'dispatch-service', slug: 'dispatch/reassign-courier', grade: 1 },
    ],
    required_facts: [
      { id: 'preferred-courier', patterns: [/preferred[ _]courier/i] },
      { id: 'cancel-deadline', patterns: [minutes('20')] },
      { id: 'free-cancel', patterns: [/fee[ _]waived|waive|without (a |the |any )?fee|(always|is|are) free|no (cancellation )?fee|full refund|refunds? the full/i] },
    ],
  },
  {
    // v2/billing-service/decisions/psp-choice.md:35 (1.2% + 0.15 EUR), :39 (HMAC-SHA256), Decision: manual capture;
    // payments/psp-webhook.md:33 (Paylane-Signature header)
    id: 'psp-choice-adr',
    tags: ['ops'],
    question: 'Why did Parcelly choose Paylane as its payment provider, and how are Paylane webhooks authenticated?',
    expected_docs: [
      { library_id: 'billing-service', slug: 'decisions/psp-choice', grade: 2 },
      { library_id: 'billing-service', slug: 'payments/psp-webhook', grade: 1 },
    ],
    required_facts: [
      { id: 'manual-capture', patterns: [/manual[ _-]capture|capture[ _]method\s*=?\s*manual/i] },
      { id: 'fee', patterns: [/1[.,]2\s*%/] },
      { id: 'signature', patterns: [/HMAC[- ]?SHA[- ]?256/i] },
    ],
  },
  // ---------------------------------------------------------------- version (v2 is current)
  {
    // v2/orders-service/orders/cancel-order.md:62-63 (free ≤ 2 min after assigned_at, then 3.50 EUR); v1 was 3.00
    id: 'cancel-fee-after-assign',
    tags: ['fact', 'version'],
    question: 'How much does it cost to cancel an order after a courier has been assigned?',
    expected_docs: [{ library_id: 'orders-service', slug: 'orders/cancel-order', grade: 2 }],
    required_facts: [
      { id: 'fee', patterns: eur('3.50') },
      { id: 'free-window', patterns: [minutes('2'), seconds('120'), /two minutes/i] },
    ],
    forbidden: [{ id: 'v1-fee', patterns: eur('3.00') }],
  },
  {
    // v2/orders-service/jobs/expire-unpaid-orders.md:24 (10 minutes); v1 was 15 minutes
    id: 'unpaid-order-expiry',
    tags: ['version'],
    question: 'How long does a customer have to pay for an order before it expires?',
    expected_docs: [
      { library_id: 'orders-service', slug: 'jobs/expire-unpaid-orders', grade: 2 },
      { library_id: 'orders-service', slug: 'orders/create-order', grade: 1 },
    ],
    required_facts: [{ id: 'expiry', patterns: [minutes('10')] }],
    forbidden: [{ id: 'v1-expiry', patterns: [minutes('15')] }],
  },
  {
    // v2/orders-service/orders/create-order.md:46,73 (tip 0.00–20.00 EUR, max 2 decimals; new in v2);
    // billing v2 payments/on-order-created.md:40,49 and billing/overview.md:97 agree (0.00–20.00)
    id: 'courier-tip',
    tags: ['version'],
    question: 'Can a customer tip the courier, and what are the limits on the tip?',
    expected_docs: [
      { library_id: 'orders-service', slug: 'orders/create-order', grade: 2 },
      { library_id: 'orders-service', slug: 'events/order-created', grade: 1 },
      { library_id: 'billing-service', slug: 'payments/capture-payment', grade: 1 },
    ],
    required_facts: [
      // the 0.00 minimum must be stated; "optional" alone is not enough. Matches "0.00–20.00 EUR", "between 0 and 20 €", "minimum of 0,00".
      { id: 'min-tip', patterns: [/(?<![\d.,])0(?:[.,]00?)?\s*(?:EUR|€|euros?)?\s*(?:–|—|-|to|and)\s*(?:€\s*)?20(?:[.,]00?)?(?![\d])/i, /min(?:imum)?(?: tip)?(?: of| is|:)?\s*(?:€\s*)?0(?:[.,]00?)?(?![\d.,])/i] },
      { id: 'max-tip', patterns: [...eur('20.00'), /0[.,]00\s*(–|-|to|and)\s*(€\s*)?20([.,]00)?/i, /(up to|max(imum)?( of)?)\s*(€\s*)?20([.,]00)?\s*(EUR|€|euros?)/i] },
    ],
  },
  // ---------------------------------------------------------------- branch / scoped
  {
    // branch-batch-dispatch/dispatch-service/dispatch/batch-matcher.md:43 (2 orders), :44 (600 m),
    // :45 (45° bearings), :48 (batch offer timeout 60 s)
    id: 'batch-dispatch-branch',
    tags: ['branch', 'scoped'],
    scope: { library_id: 'dispatch-service', branch: 'feature/batch-dispatch' },
    question: 'How does batched dispatch work?',
    expected_docs: [
      { library_id: 'dispatch-service', slug: 'dispatch/batch-matcher', grade: 2 },
      { library_id: 'dispatch-service', slug: 'dispatch/overview', grade: 1 },
      { library_id: 'dispatch-service', slug: 'dispatch/assign-courier', grade: 1 },
    ],
    required_facts: [
      { id: 'pickup-distance', patterns: [/(?<![\d.,])600\s*(m\b|meters?|metres?)/i] },
      { id: 'max-orders', patterns: [/(up to|at most|max(imum)?( of)?)\s*(2|two)\s+orders/i, /(?<![\d.,])(2|two)\s+orders/i, /batch(es)? of (2|two)/i] },
      { id: 'offer-timeout', patterns: [seconds('60')] },
      { id: 'direction', patterns: [/(?<![\d.,])45\s*(°|deg)/i] },
    ],
  },
  {
    // v1/dispatch-service/dispatch/assign-courier.md:44-46 (5 km → 8 km, 45 s), :58 (rank by road ETA to the pickup)
    id: 'assignment-algorithm-scoped',
    tags: ['scoped'],
    scope: { library_id: 'dispatch-service' },
    question: 'How does the assignment algorithm choose a courier for an order?',
    expected_docs: [
      { library_id: 'dispatch-service', slug: 'dispatch/assign-courier', grade: 2 },
      { library_id: 'dispatch-service', slug: 'dispatch/overview', grade: 1 },
    ],
    required_facts: [
      { id: 'nearest', patterns: [/nearest|closest|road ETA|shortest ETA/i] },
      { id: 'radius', patterns: [km('5')] },
      { id: 'expanded', patterns: [km('8')] },
      { id: 'offer-timeout', patterns: [seconds('45')] },
    ],
  },
  // ---------------------------------------------------------------- non-english
  {
    // v2/orders-service/orders/cancel-order.md:63 (3.50 EUR after the 2-minute window)
    id: 'cancel-fee-ru',
    tags: ['non-english'],
    question: 'Сколько стоит отмена заказа после назначения курьера?',
    expected_docs: [{ library_id: 'orders-service', slug: 'orders/cancel-order', grade: 2 }],
    required_facts: [{ id: 'fee', patterns: eur('3.50') }],
    forbidden: [{ id: 'v1-fee', patterns: eur('3.00') }],
  },
  {
    // v2/orders-service/orders/quote-delivery.md:46-49 (4.90 base + 0.80 × km)
    id: 'price-formula-de',
    tags: ['non-english'],
    question: 'Wie wird der Lieferpreis berechnet?',
    expected_docs: [
      { library_id: 'orders-service', slug: 'orders/quote-delivery', grade: 2 },
      { library_id: 'orders-service', slug: 'orders/overview', grade: 1 },
    ],
    required_facts: [
      { id: 'base', patterns: [...eur('4.90'), /grund\w*[^.\n]{0,40}4[.,]90/i] },
      { id: 'per-km', patterns: [...eur('0.80'), /0[.,]80[^.\n]{0,20}(\/|per|pro)\s*km/i] },
    ],
  },
  // ---------------------------------------------------------------- unanswerable
  {
    // No document covers parcel insurance.
    id: 'parcel-insurance',
    tags: ['unanswerable'],
    question: 'What does Parcelly parcel insurance cover, and up to what value?',
    unanswerable: true,
    expected_docs: [],
    required_facts: [NO_DOCS],
    forbidden: [INSURED_AMOUNT],
  },
  {
    // No document states courier salaries (only per-order earnings, tips and fee payouts).
    id: 'courier-salary',
    tags: ['unanswerable'],
    question: 'What is the monthly salary of a Parcelly courier?',
    unanswerable: true,
    expected_docs: [],
    required_facts: [NO_DOCS],
    forbidden: [SALARY_AMOUNT],
  },
];
