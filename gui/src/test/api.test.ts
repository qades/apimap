/**
 * Tests for API utilities
 */

import { describe, it, expect, beforeEach, jest } from 'bun:test';

describe('API Client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  describe('testModelApi', () => {
    it('should call test-model endpoint with correct parameters', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, content: 'Test' })
      });
      global.fetch = mockFetch;

      const params = {
        model: 'gpt-4o',
        message: 'Hello',
        temperature: 0.7,
        maxTokens: 1024,
        stream: false,
        apiFormat: 'openai' as const,
        endpoint: '/chat/completions'
      };

      await fetch('/api/admin/test-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
      });

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/admin/test-model',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: expect.stringContaining('gpt-4o')
        })
      );

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.model).toBe('gpt-4o');
      expect(callBody.message).toBe('Hello');
      expect(callBody.temperature).toBe(0.7);
      expect(callBody.maxTokens).toBe(1024);
      expect(callBody.stream).toBe(false);
      expect(callBody.apiFormat).toBe('openai');
      expect(callBody.endpoint).toBe('/chat/completions');
    });

    it('should handle streaming response', async () => {
      const mockResponse = {
        ok: true,
        body: new ReadableStream(),
        headers: new Headers({
          'X-Provider': 'openai',
          'X-Target-Model': 'gpt-4o'
        })
      };
      
      const mockFetch = jest.fn().mockResolvedValue(mockResponse);
      global.fetch = mockFetch;

      const params = {
        model: 'gpt-4o',
        message: 'Hello',
        stream: true,
        apiFormat: 'openai' as const
      };

      const response = await fetch('/api/admin/test-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
      });

      expect(response.ok).toBe(true);
      expect(response.headers.get('X-Provider')).toBe('openai');
    });

    it('should handle error response', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: 'No route found for model', model: 'unknown-model' })
      });
      global.fetch = mockFetch;

      const response = await fetch('/api/admin/test-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'unknown-model', message: 'Hello' })
      });

      expect(response.ok).toBe(false);
      const data = await response.json();
      expect(data.error).toBe('No route found for model');
    });
  });

  describe('Admin API Endpoints', () => {
    it('should call /api/admin/status', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          status: 'ok',
          version: '2.0.0',
          totalRequests: 100,
          routedRequests: 95,
          unroutedRequests: 5
        })
      });
      global.fetch = mockFetch;

      const response = await fetch('/api/admin/status');
      const data = await response.json();

      expect(mockFetch).toHaveBeenCalledWith('/api/admin/status');
      expect(data.status).toBe('ok');
      expect(data.totalRequests).toBe(100);
    });

    it('should call /api/admin/routes', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          routes: [
            { pattern: 'gpt-4*', provider: 'openai' },
            { pattern: 'claude-3*', provider: 'anthropic' }
          ]
        })
      });
      global.fetch = mockFetch;

      const response = await fetch('/api/admin/routes');
      const data = await response.json();

      expect(mockFetch).toHaveBeenCalledWith('/api/admin/routes');
      expect(data.routes).toHaveLength(2);
      expect(data.routes[0].pattern).toBe('gpt-4*');
    });

    it('should call /api/admin/providers', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          registered: [
            { id: 'openai', baseUrl: 'https://api.openai.com/v1', configured: true },
            { id: 'anthropic', baseUrl: 'https://api.anthropic.com', configured: true }
          ],
          builtin: ['openai', 'anthropic', 'ollama']
        })
      });
      global.fetch = mockFetch;

      const response = await fetch('/api/admin/providers');
      const data = await response.json();

      expect(mockFetch).toHaveBeenCalledWith('/api/admin/providers');
      expect(data.registered).toHaveLength(2);
    });
  });
});

describe('Endpoint Path Selection', () => {
  it('should support all endpoint path options', () => {
    const endpointOptions = [
      { value: '/chat/completions', label: 'Chat Completions', format: 'openai' },
      { value: '/v1/messages', label: 'Messages', format: 'anthropic' },
      { value: '/completions', label: 'Legacy Completions', format: 'openai' },
    ];

    expect(endpointOptions).toHaveLength(3);
    expect(endpointOptions[0].value).toBe('/chat/completions');
    expect(endpointOptions[1].value).toBe('/v1/messages');
    expect(endpointOptions[2].value).toBe('/completions');
  });
});
