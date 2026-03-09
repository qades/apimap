import { describe, test, expect } from "bun:test";
import {
  parseRequest,
  toProviderRequest,
  parseResponse,
  toProviderResponse,
  parseStreamChunk,
  toProviderStreamChunk,
  createStreamStart,
  createStreamStop,
  mapStopReason,
  detectFormat,
} from "./index.ts";
import type { OpenAIRequest, OpenAIResponse, AnthropicRequest, AnthropicResponse } from "../types/index.ts";

describe("Transformer Registry", () => {
  const mockMetadata = {
    sourceFormat: "openai" as const,
    endpoint: "/v1/chat/completions",
    headers: {},
    requestId: "test-123",
    timestamp: "2024-01-01T00:00:00Z",
  };

  describe("parseRequest", () => {
    test("should parse OpenAI format", () => {
      const openaiReq: OpenAIRequest = {
        model: "gpt-4",
        messages: [{ role: "user", content: "Hello" }],
      };

      const internal = parseRequest("openai", openaiReq, mockMetadata);

      expect(internal.model).toBe("gpt-4");
      expect(internal.messages[0].content).toBe("Hello");
    });

    test("should parse Anthropic format", () => {
      const anthropicReq: AnthropicRequest = {
        model: "claude-3",
        messages: [{ role: "user", content: "Hello" }],
        max_tokens: 1024,
      };

      const internal = parseRequest("anthropic", anthropicReq, mockMetadata);

      expect(internal.model).toBe("claude-3");
      expect(internal.maxTokens).toBe(1024);
    });

    test("should throw for unsupported format", () => {
      expect(() => {
        parseRequest("unsupported" as any, {}, mockMetadata);
      }).toThrow();
    });
  });

  describe("toProviderRequest", () => {
    test("should convert to OpenAI format", () => {
      const internal = {
        model: "gpt-4",
        targetModel: "gpt-4-turbo",
        messages: [{ role: "user" as const, content: "Hello" }],
        metadata: mockMetadata,
      };

      const openaiReq = toProviderRequest("openai", internal);

      expect(openaiReq.model).toBe("gpt-4-turbo");
    });

    test("should convert to Anthropic format", () => {
      const internal = {
        model: "claude-3",
        targetModel: "claude-3-opus",
        messages: [{ role: "user" as const, content: "Hello" }],
        metadata: mockMetadata,
      };

      const anthropicReq = toProviderRequest("anthropic", internal);

      expect(anthropicReq.model).toBe("claude-3-opus");
      expect(anthropicReq.max_tokens).toBeDefined();
    });
  });

  describe("parseResponse", () => {
    test("should parse OpenAI response", () => {
      const openaiResp: OpenAIResponse = {
        id: "resp-123",
        object: "chat.completion",
        created: 1700000000,
        model: "gpt-4",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Hello" },
            finish_reason: "stop",
          },
        ],
      };

      const internal = parseResponse("openai", openaiResp);

      expect(internal.id).toBe("resp-123");
      expect(internal.stopReason).toBe("end_turn");
    });

    test("should parse Anthropic response", () => {
      const anthropicResp: AnthropicResponse = {
        id: "msg-123",
        type: "message",
        role: "assistant",
        model: "claude-3",
        content: [{ type: "text", text: "Hello" }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 5 },
      };

      const internal = parseResponse("anthropic", anthropicResp);

      expect(internal.id).toBe("msg-123");
      expect(internal.stopReason).toBe("end_turn");
    });
  });

  describe("parseStreamChunk", () => {
    test("should parse OpenAI stream chunk", () => {
      const line = 'data: {"choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}';
      const chunk = parseStreamChunk("openai", line);

      expect(chunk).not.toBeNull();
      expect(chunk?.delta.text).toBe("Hello");
    });

    test("should parse Anthropic stream chunk", () => {
      const line = 'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}';
      const chunk = parseStreamChunk("anthropic", line);

      expect(chunk).not.toBeNull();
      expect(chunk?.delta.text).toBe("Hello");
    });

    test("should handle [DONE] marker", () => {
      const chunk = parseStreamChunk("openai", "data: [DONE]");
      expect(chunk?.isComplete).toBe(true);
    });

    test("should return null for invalid line", () => {
      const chunk = parseStreamChunk("openai", "invalid");
      expect(chunk).toBeNull();
    });
  });

  describe("toProviderStreamChunk", () => {
    test("should convert to OpenAI SSE", () => {
      const chunk = {
        index: 0,
        delta: { type: "text" as const, text: "Hello" },
      };

      const sse = toProviderStreamChunk("openai", chunk, "gpt-4");

      expect(sse).toContain("data:");
      expect(sse).toContain("Hello");
    });

    test("should convert to Anthropic SSE", () => {
      const chunk = {
        index: 0,
        delta: { type: "text" as const, text: "Hello" },
      };

      const sse = toProviderStreamChunk("anthropic", chunk, "claude-3");

      expect(sse).toContain("content_block_delta");
    });
  });

  describe("createStreamStart", () => {
    test("should create Anthropic stream start", () => {
      const start = createStreamStart("anthropic", "msg-123", { input_tokens: 100 });
      expect(start).toContain("message_start");
    });

    test("should return empty for OpenAI", () => {
      const start = createStreamStart("openai", "msg-123");
      expect(start).toBe("");
    });
  });

  describe("createStreamStop", () => {
    test("should create Anthropic stream stop", () => {
      const stop = createStreamStop("anthropic", "end_turn", 50);
      expect(stop).toContain("message_delta");
      expect(stop).toContain("[DONE]");
    });

    test("should create OpenAI stream stop", () => {
      const stop = createStreamStop("openai", "stop", 50);
      expect(stop).toContain("[DONE]");
    });
  });

  describe("mapStopReason", () => {
    test("should map OpenAI to Anthropic stop reasons", () => {
      expect(mapStopReason("openai", "anthropic", "stop")).toBe("end_turn");
      expect(mapStopReason("openai", "anthropic", "tool_calls")).toBe("tool_use");
      expect(mapStopReason("openai", "anthropic", "length")).toBe("max_tokens");
    });

    test("should map Anthropic to OpenAI stop reasons", () => {
      expect(mapStopReason("anthropic", "openai", "end_turn")).toBe("stop");
      expect(mapStopReason("anthropic", "openai", "tool_use")).toBe("tool_calls");
      expect(mapStopReason("anthropic", "openai", "max_tokens")).toBe("length");
    });

    test("should return null for unknown reasons", () => {
      expect(mapStopReason("openai", "anthropic", "unknown")).toBeNull();
    });
  });

  describe("detectFormat", () => {
    test("should detect Anthropic format", () => {
      const body = {
        model: "claude-3",
        messages: [{ role: "user", content: "Hello" }],
        max_tokens: 1024,
        stop_sequences: [],
      };

      const format = detectFormat(body);
      expect(format).toBe("anthropic");
    });

    test("should detect Anthropic format by tools", () => {
      const body = {
        model: "claude-3",
        messages: [{ role: "user", content: "Hello" }],
        max_tokens: 1024,
        tools: [{ name: "test", input_schema: { type: "object" } }],
      };

      const format = detectFormat(body);
      expect(format).toBe("anthropic");
    });

    test("should detect OpenAI format", () => {
      const body = {
        model: "gpt-4",
        messages: [{ role: "user", content: "Hello" }],
        temperature: 0.7,
      };

      const format = detectFormat(body);
      expect(format).toBe("openai");
    });

    test("should return null for unknown format", () => {
      const body = { foo: "bar" };
      const format = detectFormat(body);
      expect(format).toBeNull();
    });
  });
});
