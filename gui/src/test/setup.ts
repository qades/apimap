import { beforeAll, afterAll, afterEach } from 'bun:test';
import { Window } from 'happy-dom';

// Set up happy-dom for DOM testing
const window = new Window({
  url: 'http://localhost:3001',
  width: 1024,
  height: 768
});

// Set up global DOM APIs
global.document = window.document;
global.window = window as any;
global.HTMLElement = window.HTMLElement as any;
global.Element = window.Element as any;
global.Node = window.Node as any;
global.DocumentFragment = window.DocumentFragment as any;
global.Event = window.Event as any;
global.CustomEvent = window.CustomEvent as any;
global.MouseEvent = window.MouseEvent as any;
global.KeyboardEvent = window.KeyboardEvent as any;
global.location = window.location;

// Mock fetch globally
beforeAll(() => {
  global.fetch = jest.fn();
});

afterEach(() => {
  // Clean up after each test
  jest.clearAllMocks();
  // Reset document body
  document.body.innerHTML = '';
});

afterAll(() => {
  // Clean up after all tests
  window.close();
});

// Extend expect with jest-dom matchers
import '@testing-library/jest-dom';
