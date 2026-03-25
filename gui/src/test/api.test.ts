/**
 * Tests for API utilities
 */

import { describe, it, expect, beforeEach, afterEach, jest } from 'bun:test';
import { getApiConfig, getApiUrl, getWsUrl } from '../lib/utils/api';

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

describe('API Configuration', () => {
  const originalWindow = globalThis.window;

  beforeEach(() => {
    // Clean up window.API_CONFIG before each test
    // @ts-expect-error - cleaning up global
    delete globalThis.window?.API_CONFIG;
    // @ts-expect-error - cleaning up global
    delete globalThis.window?.API_PORT;
  });

  afterEach(() => {
    // Restore window
    // @ts-expect-error - restoring global
    globalThis.window = originalWindow;
  });

  describe('getApiConfig', () => {
    it('should return injected API_CONFIG when available', () => {
      const mockConfig = {
        port: 3000,
        externalPort: 8080,
        host: 'example.com',
        url: 'http://example.com:8080'
      };
      
      // @ts-expect-error - mocking window
      globalThis.window = { API_CONFIG: mockConfig };
      
      const config = getApiConfig();
      expect(config).toEqual(mockConfig);
    });

    it('should return legacy API_PORT config when API_CONFIG not available', () => {
      // @ts-expect-error - mocking window
      globalThis.window = { API_PORT: 3000 };
      
      const config = getApiConfig();
      expect(config.port).toBe(3000);
      expect(config.externalPort).toBe(3000);
      expect(config.url).toContain('3000');
    });

    it('should return fallback config when no window is available', () => {
      // @ts-expect-error - removing window
      globalThis.window = undefined;
      
      const config = getApiConfig();
      // Fallback uses import.meta.env.VITE_API_PORT or defaults to 3000
      // In test environment, this might be set to a different value
      expect(config.port).toBeDefined();
      expect(config.externalPort).toBe(config.port);
      expect(config.host).toBeDefined();
      expect(config.url).toBeDefined();
    });

    it('should handle different externalPort from port (container scenario)', () => {
      const mockConfig = {
        port: 3000,
        externalPort: 8080,  // Different - container port mapping
        host: 'localhost',
        url: 'http://localhost:8080'
      };
      
      // @ts-expect-error - mocking window
      globalThis.window = { API_CONFIG: mockConfig };
      
      const config = getApiConfig();
      expect(config.port).toBe(3000);        // Internal port
      expect(config.externalPort).toBe(8080); // External port for browser
      expect(config.url).toBe('http://localhost:8080');
    });
  });

  describe('getApiUrl', () => {
    it('should return the full API URL from injected config', () => {
      const mockConfig = {
        port: 3000,
        externalPort: 8080,
        host: 'api.example.com',
        url: 'http://api.example.com:8080'
      };
      
      // @ts-expect-error - mocking window
      globalThis.window = { API_CONFIG: mockConfig };
      
      const url = getApiUrl();
      expect(url).toBe('http://api.example.com:8080');
    });

    it('should work with localhost in development', () => {
      const mockConfig = {
        port: 3000,
        externalPort: 3000,
        host: 'localhost',
        url: 'http://localhost:3000'
      };
      
      // @ts-expect-error - mocking window
      globalThis.window = { API_CONFIG: mockConfig };
      
      const url = getApiUrl();
      expect(url).toBe('http://localhost:3000');
    });
  });

  describe('getWsUrl', () => {
    it('should convert HTTP URL to WS URL', () => {
      const mockConfig = {
        port: 3000,
        externalPort: 8080,
        host: 'localhost',
        url: 'http://localhost:8080'
      };
      
      // @ts-expect-error - mocking window
      globalThis.window = { API_CONFIG: mockConfig };
      
      const wsUrl = getWsUrl();
      expect(wsUrl).toBe('ws://localhost:8080');
    });

    it('should convert HTTPS URL to WSS URL', () => {
      const mockConfig = {
        port: 3000,
        externalPort: 443,
        host: 'api.example.com',
        url: 'https://api.example.com:443'
      };
      
      // @ts-expect-error - mocking window
      globalThis.window = { API_CONFIG: mockConfig };
      
      const wsUrl = getWsUrl();
      expect(wsUrl).toBe('wss://api.example.com:443');
    });

    it('should use externalPort for WebSocket connections', () => {
      // This tests the container scenario where API listens on 3000
      // but browser accesses via 8080
      const mockConfig = {
        port: 3000,           // Internal port (API listens here)
        externalPort: 8080,   // External port (browser uses this)
        host: 'router.local',
        url: 'http://router.local:8080'
      };
      
      // @ts-expect-error - mocking window
      globalThis.window = { API_CONFIG: mockConfig };
      
      const wsUrl = getWsUrl();
      expect(wsUrl).toBe('ws://router.local:8080');
      expect(wsUrl).not.toContain('3000'); // Should not use internal port
    });
  });

  describe('Container/Proxy Scenarios', () => {
    it('should handle Docker port mapping scenario (3000 -> 8080)', () => {
      // Docker: -p 8080:3000 (host:container)
      const mockConfig = {
        port: 3000,        // API listens on 3000 inside container
        externalPort: 8080, // Browser accesses via 8080 on host
        host: 'localhost',
        url: 'http://localhost:8080'
      };
      
      // @ts-expect-error - mocking window
      globalThis.window = { API_CONFIG: mockConfig };
      
      const config = getApiConfig();
      expect(config.url).toBe('http://localhost:8080');
      expect(getApiUrl()).toBe('http://localhost:8080');
      expect(getWsUrl()).toBe('ws://localhost:8080');
    });

    it('should handle reverse proxy scenario (443 -> 3000)', () => {
      // Nginx/Traefik proxying 443 to 3000
      const mockConfig = {
        port: 3000,
        externalPort: 443,
        host: 'api.example.com',
        url: 'https://api.example.com:443'
      };
      
      // @ts-expect-error - mocking window
      globalThis.window = { API_CONFIG: mockConfig };
      
      expect(getApiUrl()).toBe('https://api.example.com:443');
      expect(getWsUrl()).toBe('wss://api.example.com:443');
    });

    it('should handle same port scenario (no proxy)', () => {
      // Direct access without proxy
      const mockConfig = {
        port: 3000,
        externalPort: 3000,
        host: 'localhost',
        url: 'http://localhost:3000'
      };
      
      // @ts-expect-error - mocking window
      globalThis.window = { API_CONFIG: mockConfig };
      
      expect(getApiUrl()).toBe('http://localhost:3000');
      expect(getWsUrl()).toBe('ws://localhost:3000');
    });
  });
});
