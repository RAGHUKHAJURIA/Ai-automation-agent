import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

const app = createApp({ WEB_ORIGIN: 'http://localhost:5173' });

describe('health routes', () => {
  it('reports API liveness without requiring an open application server', async () => {
    const response = await request(app).get('/health/live');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', service: 'api' });
  });

  it('reports unavailable dependencies instead of claiming readiness', async () => {
    const response = await request(app).get('/health/ready');
    expect(response.status).toBe(503);
    expect(response.body.dependencies).toEqual({ mongodb: 'unavailable', redis: 'unavailable', queue: 'unavailable' });
  });
});
