import { describe, test, expect } from "bun:test";
import {
  parseOpenAIRequest,
  toOpenAIRequest,
  parseOpenAIResponse,
  toOpenAIResponse,
  parseOpenAIStreamChunk,
  toOpenAIStreamChunk,
} from "./openai.ts";
import type { OpenAIRequest, OpenAIResponse } from "../types/index.ts";
import type { InternalRequest } from "../types/internal.ts";

describe("OpenAI Transformer", () => {
  describe("parseOpenAIRequest", () => {
    test("should parse basic OpenAI request", () => {
      const openaiReq: OpenAIRequest = {
        model: "gpt-4",
        messages: [
          { role: "user", content: "Hello" },
        ],
      };

      const internal = parseOpenAIRequest(openaiReq, {
        sourceFormat: "openai",
        endpoint: "/v1/chat/completions",
        headers: {},
        requestId: "test-123",
        timestamp: "2024-01-01T00:00:00Z",
      });

      expect(internal.model).toBe("gpt-4");
      expect(internal.messages.length).toBe(1);
      expect(internal.messages[0].role).toBe("user");
      expect(internal.messages[0].content).toBe("Hello");
    });

    test("should parse request with system message", () => {
      const openaiReq: OpenAIRequest = {
        model: "gpt-4",
        messages: [
          { role: "system", content: "You are helpful" },
          { role: "user", content: "Hello" },
        ],
      };

      const internal = parseOpenAIRequest(openaiReq, {
        sourceFormat: "openai",
        endpoint: "/v1/chat/completions",
        headers: {},
        requestId: "test-123",
        timestamp: "2024-01-01T00:00:00Z",
      });

      expect(internal.system).toBe("You are helpful");
      expect(internal.messages.length).toBe(1); // system extracted
      expect(internal.messages[0].role).toBe("user");
    });

    test("should parse request with all parameters", () => {
      const openaiReq: OpenAIRequest = {
        model: "gpt-4",
        messages: [{ role: "user", content: "Hello" }],
        max_tokens: 100,
        temperature: 0.7,
        top_p: 0.9,
        stream: true,
        stop: ["END"],
      };

      const internal = parseOpenAIRequest(openaiReq, {
        sourceFormat: "openai",
        endpoint: "/v1/chat/completions",
        headers: {},
        requestId: "test-123",
        timestamp: "2024-01-01T00:00:00Z",
      });

      expect(internal.maxTokens).toBe(100);
      expect(internal.temperature).toBe(0.7);
      expect(internal.topP).toBe(0.9);
      expect(internal.stream).toBe(true);
      expect(internal.stopSequences).toEqual(["END"]);
    });

    test("should use max_completion_tokens as fallback", () => {
      const openaiReq: OpenAIRequest = {
        model: "gpt-4",
        messages: [{ role: "user", content: "Hello" }],
        max_completion_tokens: 200,
      };

      const internal = parseOpenAIRequest(openaiReq, {
        sourceFormat: "openai",
        endpoint: "/v1/chat/completions",
        headers: {},
        requestId: "test-123",
        timestamp: "2024-01-01T00:00:00Z",
      });

      expect(internal.maxTokens).toBe(200);
    });
  });

  describe("toOpenAIRequest", () => {
    test("should convert internal to OpenAI request", () => {
      const internal: InternalRequest = {
        model: "gpt-4",
        targetModel: "gpt-4-turbo",
        messages: [{ role: "user", content: "Hello" }],
        metadata: {
          sourceFormat: "anthropic",
          endpoint: "/v1/messages",
          headers: {},
          requestId: "test-123",
          timestamp: "2024-01-01T00:00:00Z",
        },
      };

      const openaiReq = toOpenAIRequest(internal);

      expect(openaiReq.model).toBe("gpt-4-turbo");
      expect(openaiReq.messages.length).toBe(1);
    });

    test("should add system message", () => {
      const internal: InternalRequest = {
        model: "gpt-4",
        messages: [{ role: "user", content: "Hello" }],
        system: "You are helpful",
        metadata: {
          sourceFormat: "anthropic",
          endpoint: "/v1/messages",
          headers: {},
          requestId: "test-123",
          timestamp: "2024-01-01T00:00:00Z",
        },
      };

      const openaiReq = toOpenAIRequest(internal);

      expect(openaiReq.messages.length).toBe(2);
      expect(openaiReq.messages[0].role).toBe("system");
      expect(openaiReq.messages[0].content).toBe("You are helpful");
    });

    test("should handle tools", () => {
      const internal: InternalRequest = {
        model: "gpt-4",
        messages: [{ role: "user", content: "Hello" }],
        tools: [
          {
            name: "get_weather",
            description: "Get the weather",
            parameters: {
              type: "object",
              properties: {
                location: { type: "string" },
              },
            },
          },
        ],
        toolChoice: "auto",
        metadata: {
          sourceFormat: "anthropic",
          endpoint: "/v1/messages",
          headers: {},
          requestId: "test-123",
          timestamp: "2024-01-01T00:00:00Z",
        },
      };

      const openaiReq = toOpenAIRequest(internal);

      expect(openaiReq.tools?.length).toBe(1);
      expect(openaiReq.tools?.[0].type).toBe("function");
      expect(openaiReq.tools?.[0].function.name).toBe("get_weather");
      expect(openaiReq.tool_choice).toBe("auto");
    });
  });

  describe("parseOpenAIResponse", () => {
    test("should parse basic response", () => {
      const openaiResp: OpenAIResponse = {
        id: "resp-123",
        object: "chat.completion",
        created: 1700000000,
        model: "gpt-4",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "Hello there!",
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      };

      const internal = parseOpenAIResponse(openaiResp);

      expect(internal.id).toBe("resp-123");
      expect(internal.model).toBe("gpt-4");
      expect(internal.stopReason).toBe("end_turn");
      expect(internal.usage?.promptTokens).toBe(10);
      expect(internal.usage?.completionTokens).toBe(5);
    });

    test("should parse response with tool calls", () => {
      const openaiResp: OpenAIResponse = {
        id: "resp-123",
        object: "chat.completion",
        created: 1700000000,
        model: "gpt-4",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call-123",
                  type: "function",
                  function: {
                    name: "get_weather",
                    arguments: '{"location":"NYC"}',
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      };

      const internal = parseOpenAIResponse(openaiResp);

      expect(internal.stopReason).toBe("tool_use");
      expect(internal.toolCalls?.length).toBe(1);
      expect(internal.toolCalls?.[0].toolCall?.name).toBe("get_weather");
    });
  });

  describe("toOpenAIResponse", () => {
    test("should convert internal to OpenAI response", () => {
      const internal = {
        id: "msg-123",
        model: "gpt-4",
        content: [{ type: "text" as const, text: "Hello there!" }],
        stopReason: "end_turn" as const,
        usage: {
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
        },
      };

      const openaiResp = toOpenAIResponse(internal);

      expect(openaiResp.id).toBe("msg-123");
      expect(openaiResp.model).toBe("gpt-4");
      expect(openaiResp.choices[0].finish_reason).toBe("stop");
      expect(openaiResp.choices[0].message?.content).toBe("Hello there!");
    });
  });

  describe("parseOpenAIStreamChunk", () => {
    test("should parse stream chunk with content", () => {
      const chunk = parseOpenAIStreamChunk({
        choices: [
          {
            index: 0,
            delta: { content: "Hello" },
            finish_reason: null,
          },
        ],
      });

      expect(chunk).not.toBeNull();
      expect(chunk?.delta.type).toBe("text");
      expect(chunk?.delta.text).toBe("Hello");
      expect(chunk?.isComplete).toBeFalsy();
    });

    test("should parse final chunk", () => {
      const chunk = parseOpenAIStreamChunk({
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: "stop",
          },
        ],
      });

      expect(chunk?.isComplete).toBe(true);
      expect(chunk?.finishReason).toBe("stop");
    });
  });

  describe("toOpenAIStreamChunk", () => {
    test("should convert to SSE format", () => {
      const chunk = {
        index: 0,
        delta: { type: "text" as const, text: "Hello" },
      };

      const sse = toOpenAIStreamChunk(chunk, "gpt-4");

      expect(sse).toContain("data:");
      expect(sse).toContain("Hello");
      expect(sse).toContain("gpt-4");
    });
  });
});
