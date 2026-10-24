import { describe, expect, it } from 'vitest';
import type { ServerConfig } from '@personal-agent/config/server';
import { FixtureMessagingAdapter, type MessagingAdapter } from '@personal-agent/messaging';
import { createFixtureMessagingIngress } from '../src/phase6/messaging-ingress.js';

describe('Phase 6 provider eligibility gate', () => {
  it('does not enable a WhatsApp adapter through the test ingress', () => {
    const fakeWhatsApp = { provider: 'WHATSAPP' } as MessagingAdapter;
    expect(() => createFixtureMessagingIngress({} as ServerConfig, fakeWhatsApp)).toThrow(
      'MESSAGING_PROVIDER_NOT_ENABLED',
    );
  });

  it('limits the synthetic ingress to test runtime', () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(() =>
        createFixtureMessagingIngress(
          {} as ServerConfig,
          new FixtureMessagingAdapter('fixture-only-secret-that-is-at-least-32-bytes'),
        ),
      ).toThrow('MESSAGING_PROVIDER_NOT_ENABLED');
    } finally {
      process.env.NODE_ENV = original;
    }
  });
});
