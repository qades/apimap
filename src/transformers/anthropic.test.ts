import { describe, test, expect } from "bun:test";
import {
  parseAnthropicRequest,
  toAnthropicRequest,
  parseAnthropicResponse,
  toAnthropicResponse,
  parseAnthropicStreamEvent,
  toAnthropicStreamChunk,
  createAnthropicStreamStart,
  createAnthropicStreamStop,
} from "./anthropic.ts";
import type { AnthropicRequest, AnthropicResponse } from "../types/index.ts";
import type { InternalRequest } from "../types/internal.ts";

describe("Anthropic Transformer", () => {
  describe("parseAnthropicRequest", () => {
    test("should parse basic Anthropic request", () => {
      const anthropicReq: AnthropicRequest = {
        model: "claude-3-opus-20240229",
        messages: [
          { role: "user", content: "Hello" },
        ],
        max_tokens: 1024,
      };

      const internal = parseAnthropicRequest(anthropicReq, {
        sourceFormat: "anthropic",
        endpoint: "/v1/messages",
        headers: {},
        requestId: "test-123",
        timestamp: "2024-01-01T00:00:00Z",
      });

      expect(internal.model).toBe("claude-3-opus-20240229");
      expect(internal.maxTokens).toBe(1024);
      expect(internal.messages.length).toBe(1);
      expect(internal.messages[0].role).toBe("user");
    });

    test("should parse request with system message", () => {
      const anthropicReq: AnthropicRequest = {
        model: "claude-3-opus",
        system: "You are helpful",
        messages: [{ role: "user", content: "Hello" }],
        max_tokens: 1024,
      };

      const internal = parseAnthropicRequest(anthropicReq, {
        sourceFormat: "anthropic",
        endpoint: "/v1/messages",
        headers: {},
        requestId: "test-123",
        timestamp: "2024-01-01T00:00:00Z",
      });

      expect(internal.system).toBe("You are helpful");
    });

    test("should parse thinking configuration", () => {
      const anthropicReq: AnthropicRequest = {
        model: "claude-3-opus",
        messages: [{ role: "user", content: "Hello" }],
        max_tokens: 1024,
        thinking: {
          type: "enabled",
          budget_tokens: 8000,
        },
      };

      const internal = parseAnthropicRequest(anthropicReq, {
        sourceFormat: "anthropic",
        endpoint: "/v1/messages",
        headers: {},
        requestId: "test-123",
        timestamp: "2024-01-01T00:00:00Z",
      });

      expect(internal.reasoningEffort).toBe("medium");
    });

    test("should parse tools", () => {
      const anthropicReq: AnthropicRequest = {
        model: "claude-3-opus",
        messages: [{ role: "user", content: "Hello" }],
        max_tokens: 1024,
        tools: [
          {
            name: "get_weather",
            description: "Get weather",
            input_schema: {
              type: "object",
              properties: {
                location: { type: "string" },
              },
            },
          },
        ],
      };

      const internal = parseAnthropicRequest(anthropicReq, {
        sourceFormat: "anthropic",
        endpoint: "/v1/messages",
        headers: {},
        requestId: "test-123",
        timestamp: "2024-01-01T00:00:00Z",
      });

      expect(internal.tools?.length).toBe(1);
      expect(internal.tools?.[0].name).toBe("get_weather");
    });
  });

  describe("toAnthropicRequest", () => {
    test("should convert internal to Anthropic request", () => {
      const internal: InternalRequest = {
        model: "claude-3",
        targetModel: "claude-3-opus-20240229",
        messages: [{ role: "user", content: "Hello" }],
        maxTokens: 1024,
        metadata: {
          sourceFormat: "openai",
          endpoint: "/v1/chat/completions",
          headers: {},
          requestId: "test-123",
          timestamp: "2024-01-01T00:00:00Z",
        },
      };

      const anthropicReq = toAnthropicRequest(internal);

      expect(anthropicReq.model).toBe("claude-3-opus-20240229");
      expect(anthropicReq.max_tokens).toBe(1024);
    });

    test("should add system message", () => {
      const internal: InternalRequest = {
        model: "claude-3",
        messages: [{ role: "user", content: "Hello" }],
        system: "You are helpful",
        metadata: {
          sourceFormat: "openai",
          endpoint: "/v1/chat/completions",
          headers: {},
          requestId: "test-123",
          timestamp: "2024-01-01T00:00:00Z",
        },
      };

      const anthropicReq = toAnthropicRequest(internal);

      expect(anthropicReq.system).toBe("You are helpful");
    });

    test("should convert reasoning effort to thinking config", () => {
      const internal: InternalRequest = {
        model: "claude-3",
        messages: [{ role: "user", content: "Hello" }],
        reasoningEffort: "high",
        metadata: {
          sourceFormat: "openai",
          endpoint: "/v1/chat/completions",
          headers: {},
          requestId: "test-123",
          timestamp: "2024-01-01T00:00:00Z",
        },
      };

      const anthropicReq = toAnthropicRequest(internal);

      expect(anthropicReq.thinking?.type).toBe("enabled");
      expect(anthropicReq.thinking?.budget_tokens).toBe(32000);
    });
  });

  describe("parseAnthropicResponse", () => {
    test("should parse basic response", () => {
      const anthropicResp: AnthropicResponse = {
        id: "msg-123",
        type: "message",
        role: "assistant",
        model: "claude-3-opus",
        content: [{ type: "text", text: "Hello there!" }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: {
          input_tokens: 10,
          output_tokens: 5,
        },
      };

      const internal = parseAnthropicResponse(anthropicResp);

      expect(internal.id).toBe("msg-123");
      expect(internal.model).toBe("claude-3-opus");
      expect(internal.stopReason).toBe("end_turn");
      expect(internal.usage?.promptTokens).toBe(10);
      expect(internal.usage?.completionTokens).toBe(5);
    });

    test("should parse response with tool use", () => {
      const anthropicResp: AnthropicResponse = {
        id: "msg-123",
        type: "message",
        role: "assistant",
        model: "claude-3-opus",
        content: [
          {
            type: "tool_use",
            id: "tool-123",
            name: "get_weather",
            input: { location: "NYC" },
          },
        ],
        stop_reason: "tool_use",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 20 },
      };

      const internal = parseAnthropicResponse(anthropicResp);

      expect(internal.stopReason).toBe("tool_use");
      expect(internal.toolCalls?.length).toBe(1);
      expect(internal.toolCalls?.[0].toolCall?.name).toBe("get_weather");
    });

    test("should handle cache usage stats", () => {
      const anthropicResp: AnthropicResponse = {
        id: "msg-123",
        type: "message",
        role: "assistant",
        model: "claude-3-opus",
        content: [{ type: "text", text: "Hello" }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 1000,
          cache_read_input_tokens: 500,
        },
      };

      const internal = parseAnthropicResponse(anthropicResp);

      expect(internal.usage?.cacheCreationInputTokens).toBe(1000);
      expect(internal.usage?.cacheReadInputTokens).toBe(500);
    });
  });

  describe("toAnthropicResponse", () => {
    test("should convert internal to Anthropic response", () => {
      const internal = {
        id: "msg-123",
        model: "claude-3-opus",
        content: [{ type: "text" as const, text: "Hello there!" }],
        stopReason: "end_turn" as const,
        usage: {
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
        },
      };

      const anthropicResp = toAnthropicResponse(internal);

      expect(anthropicResp.id).toBe("msg-123");
      expect(anthropicResp.type).toBe("message");
      expect(anthropicResp.role).toBe("assistant");
      expect(anthropicResp.stop_reason).toBe("end_turn");
    });
  });

  describe("parseAnthropicStreamEvent", () => {
    test("should parse text delta event", () => {
      const event = parseAnthropicStreamEvent('data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}');

      expect(event).not.toBeNull();
      expect(event?.delta.type).toBe("text");
      expect(event?.delta.text).toBe("Hello");
    });

    test("should parse message_delta event", () => {
      const event = parseAnthropicStreamEvent('data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":50}}');

      expect(event?.isComplete).toBe(true);
      expect(event?.finishReason).toBe("end_turn");
      expect(event?.usage?.completionTokens).toBe(50);
    });

    test("should parse [DONE] event", () => {
      const event = parseAnthropicStreamEvent("data: [DONE]");

      expect(event?.isComplete).toBe(true);
    });

    test("should return null for invalid line", () => {
      const event = parseAnthropicStreamEvent("invalid");
      expect(event).toBeNull();
    });
  });

  describe("toAnthropicStreamChunk", () => {
    test("should convert text chunk to SSE", () => {
      const chunk = {
        index: 0,
        delta: { type: "text" as const, text: "Hello" },
      };

      const sse = toAnthropicStreamChunk(chunk);

      expect(sse).toContain("content_block_delta");
      expect(sse).toContain("Hello");
    });

    test("should convert final chunk to SSE", () => {
      const chunk = {
        index: 0,
        delta: { type: "text" as const, text: "" },
        finishReason: "end_turn" as const,
        isComplete: true,
      };

      const sse = toAnthropicStreamChunk(chunk);

      expect(sse).toContain("message_delta");
      expect(sse).toContain("end_turn");
    });
  });

  describe("createAnthropicStreamStart", () => {
    test("should create stream start events", () => {
      const start = createAnthropicStreamStart("msg-123", { input_tokens: 100 });

      expect(start).toContain("message_start");
      expect(start).toContain("msg-123");
      expect(start).toContain("content_block_start");
    });
  });

  describe("createAnthropicStreamStop", () => {
    test("should create stream stop events", () => {
      const stop = createAnthropicStreamStop("end_turn", 50);

      expect(stop).toContain("content_block_stop");
      expect(stop).toContain("message_delta");
      expect(stop).toContain("end_turn");
      expect(stop).toContain("[DONE]");
    });
  });
});
