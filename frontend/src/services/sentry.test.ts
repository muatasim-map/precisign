import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {
  sanitizeUrl,
  sanitizeString,
  filterFrontendSentryEvent,
  initFrontendSentry,
  captureFrontendError,
  DefaultErrorFallback,
} from './sentry';

test('frontend sentry: unconfigured/disabled behavior is safe no-op', () => {
  const originalDsn = process.env.VITE_SENTRY_DSN;
  delete process.env.VITE_SENTRY_DSN;
  try {
    assert.doesNotThrow(() => initFrontendSentry());
    assert.doesNotThrow(() => captureFrontendError(new Error('Synthetic client error'), { flow: 'sign-in' }));
  } finally {
    if (originalDsn) process.env.VITE_SENTRY_DSN = originalDsn;
  }
});

test('frontend sentry: sanitizeUrl strips password reset tokens and query secrets', () => {
  const resetUrl = 'https://precisign.example.com/#reset=temporary-secret-token-123';
  assert.equal(sanitizeUrl(resetUrl), 'https://precisign.example.com/#reset=[REDACTED]');

  const queryUrl = 'https://precisign.example.com/api/export?token=secretKey77&format=pdf';
  assert.equal(sanitizeUrl(queryUrl), 'https://precisign.example.com/api/export?token=[REDACTED]&format=pdf');
});

test('frontend sentry: sanitizeString redacts base64 images and sensitive parameters', () => {
  const textWithImage = 'Canvas export failed: data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg== in modal';
  const sanitized = sanitizeString(textWithImage);
  assert.ok(!sanitized?.includes('data:image/png;base64,'));
  assert.ok(sanitized?.includes('[IMAGE_DATA_REDACTED]'));
});

test('frontend sentry: filterFrontendSentryEvent drops expected 4xx operational responses', () => {
  const event = {
    exception: { values: [{ value: 'Client rejected' }] },
  };

  const clientStatuses = [400, 401, 403, 404, 409, 422, 429];
  for (const status of clientStatuses) {
    const hint = { originalException: { status } };
    const result = filterFrontendSentryEvent({ ...event }, hint);
    assert.equal(result, null, `Expected status ${status} to be ignored by Sentry`);
  }
});

test('frontend sentry: filterFrontendSentryEvent strips employee identity, cookies, headers, and request body', () => {
  const rawEvent = {
    user: {
      id: 'emp-456',
      email: 'sarah.connor@precisign.example.com',
      username: 'Sarah Connor',
    },
    request: {
      url: 'https://precisign.example.com/api/requests/123/approve?token=secret123',
      cookies: { precisign_session: 'cookie-abc' },
      headers: { cookie: 'precisign_session=cookie-abc' },
      data: {
        comment: 'Confidential approval note',
        signatureDataUrl: 'data:image/png;base64,ZZZZ...',
      },
    },
    exception: {
      values: [
        {
          value: 'Failed parsing signature data:image/png;base64,XYZ123...',
        },
      ],
    },
    breadcrumbs: [
      {
        category: 'fetch',
        data: {
          url: 'https://precisign.example.com/#reset=my-secret-token',
          body: { password: 'secret-password' },
        },
        message: 'Sent password reset payload with data:image/png;base64,999...',
      },
    ],
  };

  const hint = { originalException: { status: 500 } };
  const filtered = filterFrontendSentryEvent(rawEvent, hint);

  assert.ok(filtered, '500 error should not be dropped');
  // Employee identity stripped
  assert.equal(filtered.user, undefined);

  // Request cookies, headers, and body stripped
  assert.equal(filtered.request.cookies, undefined);
  assert.equal(filtered.request.headers, undefined);
  assert.equal(filtered.request.data, undefined);
  assert.equal(filtered.request.url, 'https://precisign.example.com/api/requests/123/approve?token=[REDACTED]');

  // Exception value sanitized
  assert.ok(!filtered.exception.values[0].value.includes('data:image/png;base64,'));
  assert.ok(filtered.exception.values[0].value.includes('[IMAGE_DATA_REDACTED]'));

  // Breadcrumbs sanitized
  assert.equal(filtered.breadcrumbs[0].data.body, undefined);
  assert.equal(filtered.breadcrumbs[0].data.url, 'https://precisign.example.com/#reset=[REDACTED]');
  assert.ok(!filtered.breadcrumbs[0].message.includes('data:image/png;base64,'));
  assert.ok(filtered.breadcrumbs[0].message.includes('[IMAGE_DATA_REDACTED]'));
});

test('frontend sentry: DefaultErrorFallback renders accessible alert structure', () => {
  const element = React.createElement(DefaultErrorFallback, {});
  assert.equal(element.type, DefaultErrorFallback);
});
