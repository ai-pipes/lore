export interface FixtureDocument {
  slug: string;
  domain: string;
  entry_type: string;
  summary: string;
  content: string;
}

export const FIXTURE_DOCS: FixtureDocument[] = [
  {
    slug: 'order-service/create-order',
    domain: 'orders',
    entry_type: 'handler',
    summary: 'Creates a new customer order',
    content: `# Create Order Handler

## Overview
The CreateOrderHandler processes incoming order creation requests.
It validates the cart contents, checks inventory availability, and creates a new order record.

## Endpoint
POST /api/orders

## Request
- customer_id: UUID of the customer placing the order
- items: Array of {product_id, quantity, price}
- shipping_address: Delivery address object

## Business Logic
1. Validate the customer exists and account is active
2. Check stock availability for each item in the cart
3. Calculate the total price including tax and shipping
4. Create order record with status PENDING
5. Reserve inventory items to prevent overselling
6. Publish OrderCreatedEvent to the orders message queue
7. Send confirmation email to customer

## Dependencies
Uses IOrderRepository for persistence, IInventoryClient via gRPC.`,
  },
  {
    slug: 'order-service/cancel-order',
    domain: 'orders',
    entry_type: 'handler',
    summary: 'Cancels an existing pending order',
    content: `# Cancel Order Handler

## Overview
Handles order cancellation requests from customers or administrators.
Only orders in PENDING or PROCESSING status can be cancelled.

## Endpoint
DELETE /api/orders/{order_id}

## Business Logic
1. Validate the order exists and belongs to the requesting customer
2. Check order status allows cancellation (PENDING or PROCESSING only)
3. Release all inventory reservations for order items
4. Trigger full refund if payment was already processed
5. Update order status to CANCELLED
6. Send cancellation confirmation email to customer
7. Publish OrderCancelledEvent

## Error Cases
- 404 if order not found
- 409 if order status does not allow cancellation (e.g., SHIPPED)`,
  },
  {
    slug: 'payment-service/charge-card',
    domain: 'payments',
    entry_type: 'handler',
    summary: 'Processes credit card payment for an order',
    content: `# Charge Card Handler

## Overview
Processes payment for a confirmed order using a credit card.
Integrates with Stripe payment gateway for secure card processing.

## Endpoint
POST /api/payments/charge

## Request
- order_id: UUID of the order to charge
- card_token: Stripe payment method token
- amount: Amount in cents

## Business Logic
1. Validate the order exists and is in AWAITING_PAYMENT status
2. Look up the customer's saved payment method or use provided card token
3. Create a Stripe payment intent with idempotency key
4. Confirm the payment intent with 3DS if required
5. Update order status to PAID on success
6. Publish PaymentSucceededEvent to the payments queue
7. Store payment record with Stripe charge ID

## Dependencies
Stripe API, IPaymentRepository`,
  },
  {
    slug: 'payment-service/refund',
    domain: 'payments',
    entry_type: 'handler',
    summary: 'Issues refund to original payment method',
    content: `# Refund Payment Handler

## Overview
Processes full or partial refunds for cancelled or returned orders.
Returns the money to the original payment method used during checkout.

## Endpoint
POST /api/payments/refund

## Request
- payment_id: UUID of the original payment record
- amount: Amount to refund in cents (use original amount for full refund)
- reason: Reason code: customer_request | defective | duplicate | fraud

## Business Logic
1. Validate the payment record exists and was successful
2. Check that refund amount does not exceed original charge
3. Call Stripe API to create a refund object
4. Update payment record with refund ID and status
5. Publish RefundProcessedEvent
6. Send refund confirmation email with estimated timeline (5-10 business days)`,
  },
  {
    slug: 'user-service/register',
    domain: 'users',
    entry_type: 'handler',
    summary: 'Registers a new user account',
    content: `# Register User Handler

## Overview
Creates a new user account with email/password authentication.
Validates email uniqueness, securely hashes the password, and initiates email verification.

## Endpoint
POST /api/users/register

## Request
- email: User email address (must be unique)
- password: Plain text password (min 8 chars, requires number and special char)
- full_name: User's display name

## Business Logic
1. Validate email format and check uniqueness against existing accounts
2. Validate password meets complexity requirements
3. Hash password using bcrypt with cost factor 12
4. Create user record with status UNVERIFIED
5. Generate email verification token (24h expiry)
6. Send verification email via notification service
7. Publish UserRegisteredEvent

## Security
- Passwords are never stored in plain text
- Verification token is single-use and time-limited`,
  },
  {
    slug: 'user-service/authenticate',
    domain: 'users',
    entry_type: 'handler',
    summary: 'Authenticates user and issues JWT tokens',
    content: `# Authenticate User Handler

## Overview
Handles user login with email and password. Issues JWT access tokens and
long-lived refresh tokens for session management.

## Endpoint
POST /api/users/login

## Request
- email: Registered user email
- password: Plain text password to verify

## Business Logic
1. Find user record by email address
2. Verify password against stored bcrypt hash using constant-time comparison
3. Check account status is VERIFIED and not suspended
4. Increment failed login counter on failure; lock after 5 attempts
5. Generate signed JWT access token (1 hour expiry, RS256)
6. Generate opaque refresh token (30 days expiry, stored hashed)
7. Record login event with IP address and user agent

## Security
- Timing-safe password comparison prevents user enumeration
- Account lockout after repeated failures`,
  },
  {
    slug: 'inventory-service/check-stock',
    domain: 'inventory',
    entry_type: 'handler',
    summary: 'Returns current stock levels for products',
    content: `# Check Stock Handler

## Overview
Returns real-time stock availability for one or more products.
Called by the order service before accepting new orders to validate item availability.

## Endpoint
GET /api/inventory/stock

## Query Parameters
- product_ids: Comma-separated list of product UUIDs (max 100)

## Response
- product_id: UUID
- total_quantity: Physical units on hand
- reserved_quantity: Units reserved by pending orders
- available_quantity: total_quantity - reserved_quantity

## Business Logic
1. Validate product IDs format and count
2. Load stock records from inventory database
3. Calculate available quantity: total - reserved
4. Return availability map keyed by product_id

## Caching
Results are cached in Redis with 30-second TTL to reduce DB load.`,
  },
  {
    slug: 'inventory-service/reserve-items',
    domain: 'inventory',
    entry_type: 'handler',
    summary: 'Reserves inventory items to prevent overselling',
    content: `# Reserve Items Handler

## Overview
Creates stock reservations for order line items. Uses distributed locking to
prevent race conditions and overselling when multiple orders compete for the same stock.

## Endpoint
POST /api/inventory/reserve

## Request
- order_id: UUID of the order requiring reservation
- items: Array of {product_id: UUID, quantity: number}

## Business Logic
1. Acquire distributed lock per product using Redis SETNX
2. Load current stock and calculate available quantity
3. Verify available stock >= requested quantity for all items
4. Create reservation records in database atomically
5. Increment reserved_quantity in stock table
6. Set reservation expiry to 30 minutes (auto-release if order not confirmed)
7. Publish StockReservedEvent

## Error Cases
- 409 Conflict if insufficient stock for any item
- 423 Locked if unable to acquire lock after retries`,
  },
  {
    slug: 'notification-service/send-email',
    domain: 'notifications',
    entry_type: 'handler',
    summary: 'Sends transactional emails via SendGrid',
    content: `# Send Email Handler

## Overview
Sends transactional emails to users using the SendGrid API.
Supports templated emails for order confirmations, password resets, and alerts.

## Endpoint
POST /api/notifications/email

## Request
- recipient: Target email address
- template_id: SendGrid dynamic template identifier
- template_data: Key-value object with template variable substitutions
- subject: Optional subject line override

## Business Logic
1. Validate recipient email format
2. Check recipient is not in the global unsubscribe list
3. Fetch template from SendGrid template registry
4. Merge template_data into template
5. Submit to SendGrid API with idempotency key to prevent duplicates
6. Store delivery record with SendGrid message_id for tracking
7. Handle bounces via SendGrid webhook (separate handler)

## Templates Used
- order_confirmation, password_reset, email_verification, refund_processed`,
  },
  {
    slug: 'notification-service/send-sms',
    domain: 'notifications',
    entry_type: 'handler',
    summary: 'Sends SMS messages via Twilio',
    content: `# Send SMS Handler

## Overview
Sends SMS text messages to customers using Twilio Programmable Messaging.
Used for order status updates, delivery alerts, and two-factor authentication codes.

## Endpoint
POST /api/notifications/sms

## Request
- phone_number: E.164 formatted phone number (e.g. +15551234567)
- message: SMS body text (max 160 characters for single SMS)
- message_type: transactional | promotional | 2fa

## Business Logic
1. Validate phone number against E.164 format regex
2. Check phone number against opt-out / STOP list
3. Enforce rate limit: max 5 transactional per day per number
4. Submit message via Twilio Messages API
5. Store delivery record with Twilio SID for status tracking
6. Poll delivery status webhook for final delivery confirmation

## Compliance
- Promotional messages require prior consent
- 2FA messages bypass opt-out list`,
  },
];

export interface SearchTestCase {
  query: string;
  expectedSlug: string;
  description: string;
  /** If true, requires vector embeddings (semantic understanding) */
  requiresEmbeddings?: boolean;
}

/**
 * Test cases solvable via FTS (keyword overlap with document content).
 * These should work without vector embeddings.
 */
export const FTS_TEST_CASES: SearchTestCase[] = [
  {
    query: 'create order customer cart',
    expectedSlug: 'order-service/create-order',
    description: 'FTS: order creation with keywords',
  },
  {
    query: 'cancel order cancellation CANCELLED status',
    expectedSlug: 'order-service/cancel-order',
    description: 'FTS: order cancellation',
  },
  {
    query: 'charge card Stripe payment intent',
    expectedSlug: 'payment-service/charge-card',
    description: 'FTS: credit card payment via Stripe',
  },
  {
    query: 'refund payment money return customer',
    expectedSlug: 'payment-service/refund',
    description: 'FTS: payment refund',
  },
  {
    query: 'register user account email password bcrypt',
    expectedSlug: 'user-service/register',
    description: 'FTS: user registration',
  },
  {
    query: 'authenticate login JWT access token refresh',
    expectedSlug: 'user-service/authenticate',
    description: 'FTS: user authentication with JWT',
  },
  {
    query: 'inventory stock availability product quantity',
    expectedSlug: 'inventory-service/check-stock',
    description: 'FTS: stock availability check',
  },
  {
    query: 'reserve items inventory lock overselling',
    expectedSlug: 'inventory-service/reserve-items',
    description: 'FTS: inventory reservation',
  },
  {
    query: 'send email notification SendGrid template',
    expectedSlug: 'notification-service/send-email',
    description: 'FTS: email via SendGrid',
  },
  {
    query: 'SMS Twilio phone message notification',
    expectedSlug: 'notification-service/send-sms',
    description: 'FTS: SMS via Twilio',
  },
];

/**
 * Test cases that require semantic understanding (paraphrase, synonym).
 * These are only run when an embedding provider is available.
 */
export const SEMANTIC_TEST_CASES: SearchTestCase[] = [
  {
    query: 'how to place a new purchase',
    expectedSlug: 'order-service/create-order',
    description: 'Semantic: "place a purchase" → create order',
    requiresEmbeddings: true,
  },
  {
    query: 'abort a transaction',
    expectedSlug: 'order-service/cancel-order',
    description: 'Semantic: "abort transaction" → cancel order',
    requiresEmbeddings: true,
  },
  {
    query: 'process credit card transaction',
    expectedSlug: 'payment-service/charge-card',
    description: 'Semantic: "credit card transaction" → charge card',
    requiresEmbeddings: true,
  },
  {
    query: 'return money to the original payment method',
    expectedSlug: 'payment-service/refund',
    description: 'Semantic: "return money" → refund',
    requiresEmbeddings: true,
  },
  {
    query: 'sign up with email and password',
    expectedSlug: 'user-service/register',
    description: 'Semantic: "sign up" → register',
    requiresEmbeddings: true,
  },
  {
    query: 'verify user credentials for login session',
    expectedSlug: 'user-service/authenticate',
    description: 'Semantic: "verify credentials" → authenticate',
    requiresEmbeddings: true,
  },
];
