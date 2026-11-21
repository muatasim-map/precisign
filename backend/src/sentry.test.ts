import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeUrl, sanitizeString, filterSentryEvent, initBackendSentry, captureBackendError } from './sentry';

test('backend sentry: unconfigured/disabled behavior is safe no-op', () => {
  const originalDsn = process.env.SENTRY_DSN;
  delete process.env.SENTRY_DSN;
  try {
    assert.doesNotThrow(() => initBackendSentry());
    assert.doesNotThrow(() => captureBackendError(new Error('Synthetic test error'), { route: '/api/test' }));
  } finally {
    if (originalDsn) process.env.SENTRY_DSN = originalDsn;
  }
});

test('backend sentry: sanitizeUrl strips password reset tokens and query secrets', () => {
  const urlWithReset = 'https://precisign.example.com/#reset=secret-token-xyz-123';
  assert.equal(sanitizeUrl(urlWithReset), 'https://precisign.example.com/#reset=[REDACTED]');

  const urlWithQueryToken = 'https://precisign.example.com/api/verify?token=secret123&user=456';
  assert.equal(sanitizeUrl(urlWithQueryToken), 'https://precisign.example.com/api/verify?token=[REDACTED]&user=456');

  const urlWithSig = 'https://precisign.example.com/api/download?sig=abcdef999';
  assert.equal(sanitizeUrl(urlWithSig), 'https://precisign.example.com/api/download?sig=[REDACTED]');
});

test('backend sentry: sanitizeString scrubs base64 signature images and sensitive keys', () => {
  const messageWithImage = 'Error rendering signature: data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg== in modal';
  const sanitized = sanitizeString(messageWithImage);
  assert.ok(!sanitized?.includes('data:image/png;base64,'));
  assert.ok(sanitized?.includes('[IMAGE_DATA_REDACTED]'));

  const messageWithReset = 'Reset failed for link https://example.com/#reset=abc-123-token';
  const sanitizedReset = sanitizeString(messageWithReset);
  assert.ok(!sanitizedReset?.includes('abc-123-token'));
  assert.ok(sanitizedReset?.includes('#reset=[REDACTED]'));
});

test('backend sentry: filterSentryEvent drops expected 4xx operational responses', () => {
  const event = {
    exception: { values: [{ value: 'Invalid credentials' }] },
  };

  const clientErrorCodes = [400, 401, 403, 404, 409, 422, 429];
  for (const status of clientErrorCodes) {
    const hint = { originalException: { status } };
    const result = filterSentryEvent({ ...event }, hint);
    assert.equal(result, null, `Expected status ${status} to be dropped by filterSentryEvent`);
  }
});

test('backend sentry: filterSentryEvent strips employee identity, request cookies, headers, and body', () => {
  const rawEvent = {
    user: {
      id: 'emp-123',
      email: 'john.smith@precisign.example.com',
      username: 'John Smith',
      ip_address: '192.168.1.50',
    },
    request: {
      url: 'https://precisign.example.com/api/requests?token=secret-auth-99',
      headers: {
        cookie: 'precisign_session=sess-secret-abc; other=val',
        authorization: 'Bearer secret-jwt-xyz',
        'x-precisign-user': 'emp-123',
      },
      cookies: {
        precisign_session: 'sess-secret-abc',
      },
      data: {
        workDescription: 'Confidential project details',
        signatureDataUrl: 'data:image/png;base64,AAAA...',
        password: 'super-secret-password',
      },
    },
    exception: {
      values: [
        {
          value: 'Failed parsing signature data:image/png;base64,iVBORw0KGgoAAA...',
        },
      ],
    },
    breadcrumbs: [
      {
        category: 'fetch',
        data: {
          url: 'https://precisign.example.com/api/auth/reset#reset=link-token-456',
          body: { password: 'secret-password' },
        },
        message: 'Calling reset with data:image/png;base64,ZZZZ...',
      },
    ],
  };

  const hint = { originalException: { status: 500 } };
  const filtered = filterSentryEvent(rawEvent, hint);

  assert.ok(filtered, '500 error should be retained');
  // Employee PII stripped
  assert.equal(filtered.user, undefined);

  // Request cookies, headers, and body completely stripped
  assert.equal(filtered.request.cookies, undefined);
  assert.equal(filtered.request.headers, undefined);
  assert.equal(filtered.request.data, undefined);
  assert.equal(filtered.request.url, 'https://precisign.example.com/api/requests?token=[REDACTED]');

  // Exception values sanitized
  assert.ok(!filtered.exception.values[0].value.includes('data:image/png;base64,'));
  assert.ok(filtered.exception.values[0].value.includes('[IMAGE_DATA_REDACTED]'));

  // Breadcrumbs sanitized
  const crumb = filtered.breadcrumbs[0];
  assert.equal(crumb.data.body, undefined);
  assert.equal(crumb.data.url, 'https://precisign.example.com/api/auth/reset#reset=[REDACTED]');
  assert.ok(!crumb.message.includes('data:image/png;base64,'));
  assert.ok(crumb.message.includes('[IMAGE_DATA_REDACTED]'));
});
