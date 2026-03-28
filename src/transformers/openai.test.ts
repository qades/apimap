import { describe, test, expect } from "bun:test";
import {
  parseOpenAIRequest,
  toOpenAIRequest,
  parseOpenAIResponse,
  toOpenAIResponse,
  parseOpenAIStreamChunk,
  toOpenAIStreamChunk,
  parseOpenAICompletionRequest,
  parseOpenAICompletionStreamChunk,
  parseOpenAIResponsesRequest,
  toOpenAICompletionResponse,
  toOpenAICompletionStreamChunk,
  toOpenAIResponsesResponse,
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

    test("should parse chunk with reasoning_content", () => {
      const chunk = parseOpenAIStreamChunk({
        choices: [
          {
            index: 0,
            delta: { content: "42", reasoning_content: "Let me calculate..." },
            finish_reason: null,
          },
        ],
      });

      expect(chunk).not.toBeNull();
      expect(chunk?.delta.type).toBe("text");
      expect(chunk?.delta.text).toBe("42");
      expect(chunk?.reasoningContent).toBe("Let me calculate...");
    });

    test("should parse chunk with only reasoning_content", () => {
      const chunk = parseOpenAIStreamChunk({
        choices: [
          {
            index: 0,
            delta: { reasoning_content: "Thinking..." },
            finish_reason: null,
          },
        ],
      });

      expect(chunk).not.toBeNull();
      expect(chunk?.reasoningContent).toBe("Thinking...");
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

    test("should include reasoning_content in SSE format", () => {
      const chunk = {
        index: 0,
        delta: { type: "text" as const, text: "The answer is 42" },
        reasoningContent: "Let me calculate: 20 + 22 = 42",
      };

      const sse = toOpenAIStreamChunk(chunk, "deepseek-r1");

      expect(sse).toContain("data:");
      expect(sse).toContain("The answer is 42");
      expect(sse).toContain("reasoning_content");
      expect(sse).toContain("Let me calculate");
    });

    test("should include reasoning_content even when no text content", () => {
      const chunk = {
        index: 0,
        delta: { type: "text" as const, text: "" },
        reasoningContent: "Thinking step by step...",
      };

      const sse = toOpenAIStreamChunk(chunk, "o1-preview");

      expect(sse).toContain("reasoning_content");
      expect(sse).toContain("Thinking step by step");
    });
  });

  // ============================================================================
  // OpenAI Legacy Completions API Tests
  // ============================================================================

  describe("parseOpenAICompletionRequest (Legacy Completions API)", () => {
    test("should parse string prompt", () => {
      const req = parseOpenAICompletionRequest({
        model: "gpt-3.5-turbo-instruct",
        prompt: "Hello, how are you?",
        max_tokens: 100,
        temperature: 0.7,
      }, {
        sourceFormat: "openai-completions",
        endpoint: "/v1/completions",
        headers: {},
        requestId: "test-123",
        timestamp: "2024-01-01T00:00:00Z",
      });

      expect(req.model).toBe("gpt-3.5-turbo-instruct");
      expect(req.messages.length).toBe(1);
      expect(req.messages[0].role).toBe("user");
      expect(req.messages[0].content).toBe("Hello, how are you?");
      expect(req.maxTokens).toBe(100);
      expect(req.temperature).toBe(0.7);
    });

    test("should parse array of string prompts", () => {
      const req = parseOpenAICompletionRequest({
        model: "gpt-3.5-turbo-instruct",
        prompt: ["Hello, ", "how are you?"],
      }, {
        sourceFormat: "openai-completions",
        endpoint: "/v1/completions",
        headers: {},
        requestId: "test-123",
        timestamp: "2024-01-01T00:00:00Z",
      });

      expect(req.messages[0].content).toBe("Hello, how are you?");
    });

    test("should handle null/undefined prompt", () => {
      const req = parseOpenAICompletionRequest({
        model: "gpt-3.5-turbo-instruct",
        prompt: null,
      }, {
        sourceFormat: "openai-completions",
        endpoint: "/v1/completions",
        headers: {},
        requestId: "test-123",
        timestamp: "2024-01-01T00:00:00Z",
      });

      expect(req.messages[0].content).toBe("");
    });

    test("should preserve completions-specific parameters", () => {
      const req = parseOpenAICompletionRequest({
        model: "gpt-3.5-turbo-instruct",
        prompt: "Test",
        suffix: " Suffix",
        echo: true,
        best_of: 3,
        logprobs: 5,
      }, {
        sourceFormat: "openai-completions",
        endpoint: "/v1/completions",
        headers: {},
        requestId: "test-123",
        timestamp: "2024-01-01T00:00:00Z",
      });

      expect(req.extensions?.suffix).toBe(" Suffix");
      expect(req.extensions?.echo).toBe(true);
      expect(req.extensions?.best_of).toBe(3);
      expect(req.extensions?.logprobs).toBe(5);
    });
  });

  describe("toOpenAICompletionResponse (Legacy Completions API)", () => {
    test("should convert internal response to completions format", () => {
      const response = toOpenAICompletionResponse({
        id: "cmpl-test123",
        model: "gpt-3.5-turbo-instruct",
        content: [{ type: "text", text: "This is a completion" }],
        stopReason: "end_turn",
        usage: {
          promptTokens: 10,
          completionTokens: 20,
          totalTokens: 30,
        },
      });

      expect(response.object).toBe("text_completion");
      expect(response.choices[0].text).toBe("This is a completion");
      expect(response.choices[0].finish_reason).toBe("stop");
      expect(response.usage?.total_tokens).toBe(30);
    });

    test("should map stop reasons correctly", () => {
      const lengthResponse = toOpenAICompletionResponse({
        id: "cmpl-test",
        model: "gpt-3.5-turbo-instruct",
        content: [{ type: "text", text: "Truncated" }],
        stopReason: "max_tokens",
      });

      expect(lengthResponse.choices[0].finish_reason).toBe("length");
    });
  });

  describe("parseOpenAICompletionStreamChunk", () => {
    test("should parse completions stream chunk with text", () => {
      const chunk = parseOpenAICompletionStreamChunk({
        id: "cmpl-test",
        object: "text_completion.chunk",
        created: 1234567890,
        model: "gpt-3.5-turbo-instruct",
        choices: [
          {
            text: "Hello",
            index: 0,
            finish_reason: null,
          },
        ],
      });

      expect(chunk).not.toBeNull();
      expect(chunk?.delta.type).toBe("text");
      expect(chunk?.delta.text).toBe("Hello");
    });

    test("should parse completions stream chunk with reasoning_content", () => {
      const chunk = parseOpenAICompletionStreamChunk({
        id: "cmpl-test",
        object: "text_completion.chunk",
        created: 1234567890,
        model: "gpt-3.5-turbo-instruct",
        choices: [
          {
            text: "",
            index: 0,
            finish_reason: null,
            reasoning_content: "Thinking...",
          },
        ],
      });

      expect(chunk).not.toBeNull();
      expect(chunk?.reasoningContent).toBe("Thinking...");
    });
  });

  describe("toOpenAICompletionStreamChunk", () => {
    test("should convert completions chunk to SSE format", () => {
      const chunk = {
        index: 0,
        delta: { type: "text" as const, text: "Hello" },
      };

      const sse = toOpenAICompletionStreamChunk(chunk, "gpt-3.5-turbo-instruct");

      expect(sse).toContain("data:");
      expect(sse).toContain("Hello");
      expect(sse).toContain("text_completion.chunk");
    });

    test("should include reasoning_content in completions SSE format", () => {
      const chunk = {
        index: 0,
        delta: { type: "text" as const, text: "" },
        reasoningContent: "Thinking step by step...",
      };

      const sse = toOpenAICompletionStreamChunk(chunk, "gpt-3.5-turbo-instruct");

      expect(sse).toContain("reasoning_content");
      expect(sse).toContain("Thinking step by step");
    });
  });

  // ============================================================================
  // OpenAI Responses API Tests
  // ============================================================================

  describe("parseOpenAIResponsesRequest (Responses API)", () => {
    test("should parse string input", () => {
      const req = parseOpenAIResponsesRequest({
        model: "gpt-4o",
        input: "Hello, world!",
        max_tokens: 100,
        temperature: 0.7,
      }, {
        sourceFormat: "openai-responses",
        endpoint: "/v1/responses",
        headers: {},
        requestId: "test-123",
        timestamp: "2024-01-01T00:00:00Z",
      });

      expect(req.model).toBe("gpt-4o");
      expect(req.messages.length).toBe(1);
      expect(req.messages[0].role).toBe("user");
      expect(req.messages[0].content).toBe("Hello, world!");
      expect(req.maxTokens).toBe(100);
      expect(req.temperature).toBe(0.7);
    });

    test("should parse array input with role-based items", () => {
      const req = parseOpenAIResponsesRequest({
        model: "gpt-4o",
        input: [
          { role: "system", content: "You are helpful" },
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi there!" },
          { role: "user", content: "How are you?" },
        ],
      }, {
        sourceFormat: "openai-responses",
        endpoint: "/v1/responses",
        headers: {},
        requestId: "test-123",
        timestamp: "2024-01-01T00:00:00Z",
      });

      // System message should be extracted
      expect(req.system).toBe("You are helpful");
      // Should have 3 non-system messages
      expect(req.messages.length).toBe(3);
      expect(req.messages[0].role).toBe("user");
      expect(req.messages[0].content).toBe("Hello");
      expect(req.messages[1].role).toBe("assistant");
      expect(req.messages[1].content).toBe("Hi there!");
    });

    test("should handle instructions field as system message", () => {
      const req = parseOpenAIResponsesRequest({
        model: "gpt-4o",
        input: "Hello",
        instructions: "Be concise",
      }, {
        sourceFormat: "openai-responses",
        endpoint: "/v1/responses",
        headers: {},
        requestId: "test-123",
        timestamp: "2024-01-01T00:00:00Z",
      });

      expect(req.system).toBe("Be concise");
    });

    test("should preserve reasoning parameters", () => {
      const req = parseOpenAIResponsesRequest({
        model: "o1-preview",
        input: "Solve this problem",
        reasoning: {
          effort: "high",
          generate_summary: true,
        },
      }, {
        sourceFormat: "openai-responses",
        endpoint: "/v1/responses",
        headers: {},
        requestId: "test-123",
        timestamp: "2024-01-01T00:00:00Z",
      });

      expect(req.extensions?.reasoning).toEqual({
        effort: "high",
        generate_summary: true,
      });
      expect(req.extensions?.enable_thinking).toBe(true);
    });

    test("should parse tools correctly", () => {
      const req = parseOpenAIResponsesRequest({
        model: "gpt-4o",
        input: "What's the weather?",
        tools: [
          {
            type: "function",
            function: {
              name: "get_weather",
              description: "Get weather for a location",
              parameters: {
                type: "object",
                properties: {
                  location: { type: "string" },
                },
              },
            },
          },
        ],
        tool_choice: "auto",
      }, {
        sourceFormat: "openai-responses",
        endpoint: "/v1/responses",
        headers: {},
        requestId: "test-123",
        timestamp: "2024-01-01T00:00:00Z",
      });

      expect(req.tools?.length).toBe(1);
      expect(req.tools?.[0].name).toBe("get_weather");
      expect(req.toolChoice).toBe("auto");
    });

    test("should preserve previous_response_id", () => {
      const req = parseOpenAIResponsesRequest({
        model: "gpt-4o",
        input: "Follow up",
        previous_response_id: "resp_prev123",
      }, {
        sourceFormat: "openai-responses",
        endpoint: "/v1/responses",
        headers: {},
        requestId: "test-123",
        timestamp: "2024-01-01T00:00:00Z",
      });

      expect(req.extensions?.previous_response_id).toBe("resp_prev123");
    });
  });

  describe("toOpenAIResponsesResponse (Responses API)", () => {
    test("should convert internal response to Responses API format", () => {
      const response = toOpenAIResponsesResponse({
        id: "resp-test123",
        model: "gpt-4o",
        content: [{ type: "text", text: "Hello, I'm doing well!" }],
        stopReason: "end_turn",
        usage: {
          promptTokens: 10,
          completionTokens: 20,
          totalTokens: 30,
        },
      });

      expect(response.object).toBe("response");
      expect(response.output.length).toBe(1);
      expect(response.output[0].type).toBe("message");
      expect(response.output[0].role).toBe("assistant");
      expect(response.output_text).toBe("Hello, I'm doing well!");
      expect(response.status).toBe("completed");
    });

    test("should include tool calls as function_call outputs", () => {
      const response = toOpenAIResponsesResponse({
        id: "resp-test123",
        model: "gpt-4o",
        content: [{ type: "text", text: "Let me check that" }],
        toolCalls: [
          {
            type: "tool_call",
            toolCall: {
              id: "call_123",
              name: "get_weather",
              arguments: { location: "Paris" },
              argumentsJson: '{"location": "Paris"}',
            },
          },
        ],
        stopReason: "tool_use",
      });

      expect(response.output.length).toBe(2);
      expect(response.output[1].type).toBe("function_call");
      expect(response.output[1].name).toBe("get_weather");
      expect(response.output[1].arguments).toBe('{"location": "Paris"}');
    });

    test("should include reasoning tokens in usage", () => {
      const response = toOpenAIResponsesResponse({
        id: "resp-test123",
        model: "o1-preview",
        content: [{ type: "text", text: "The answer is 42" }],
        usage: {
          promptTokens: 50,
          completionTokens: 100,
          totalTokens: 150,
          reasoningTokens: 40,
        },
      });

      expect(response.usage?.output_tokens_details?.reasoning_tokens).toBe(40);
    });

    test("should include reasoning_content when present", () => {
      const response = toOpenAIResponsesResponse({
        id: "resp-test123",
        model: "deepseek-r1",
        content: [{ type: "text", text: "The answer is 42" }],
        reasoningContent: "Let me think about this... 40 + 2 = 42",
      });

      expect(response.reasoning_content).toBe("Let me think about this... 40 + 2 = 42");
    });

    test("should not include reasoning_content when not present", () => {
      const response = toOpenAIResponsesResponse({
        id: "resp-test123",
        model: "gpt-4o",
        content: [{ type: "text", text: "Hello!" }],
      });

      expect(response.reasoning_content).toBeUndefined();
    });
  });

  // ============================================================================
  // Error Handling Tests
  // ============================================================================

  describe("Error handling", () => {
    test("should throw error when messages is undefined", () => {
      expect(() => {
        parseOpenAIRequest({
          model: "gpt-4",
          // messages is missing
        } as OpenAIRequest, {
          sourceFormat: "openai",
          endpoint: "/v1/chat/completions",
          headers: {},
          requestId: "test-123",
          timestamp: "2024-01-01T00:00:00Z",
        });
      }).toThrow("Invalid request: 'messages' array is required for chat completions");
    });

    test("should throw error when messages is not an array", () => {
      expect(() => {
        parseOpenAIRequest({
          model: "gpt-4",
          messages: "not an array",
        } as unknown as OpenAIRequest, {
          sourceFormat: "openai",
          endpoint: "/v1/chat/completions",
          headers: {},
          requestId: "test-123",
          timestamp: "2024-01-01T00:00:00Z",
        });
      }).toThrow("Invalid request: 'messages' array is required for chat completions");
    });
  });

  // ============================================================================
  // chat_template_kwargs Preservation Tests
  // ============================================================================

  describe("chat_template_kwargs preservation", () => {
    test("should preserve chat_template_kwargs in Responses API", () => {
      const req = parseOpenAIResponsesRequest({
        model: "gpt-4o",
        input: "Hello",
        chat_template_kwargs: {
          enable_thinking: true,
        },
      }, {
        sourceFormat: "openai-responses",
        endpoint: "/v1/responses",
        headers: {},
        requestId: "test-123",
        timestamp: "2024-01-01T00:00:00Z",
      });

      expect(req.chatTemplateKwargs).toBeDefined();
      expect(req.chatTemplateKwargs?.enable_thinking).toBe(true);
      expect(req.extensions?.chat_template_kwargs).toBeDefined();
    });

    test("should preserve chat_template_kwargs in Completions API", () => {
      const req = parseOpenAICompletionRequest({
        model: "gpt-3.5-turbo-instruct",
        prompt: "Hello",
        chat_template_kwargs: {
          enable_thinking: true,
        },
      }, {
        sourceFormat: "openai-completions",
        endpoint: "/v1/completions",
        headers: {},
        requestId: "test-123",
        timestamp: "2024-01-01T00:00:00Z",
      });

      expect(req.chatTemplateKwargs).toBeDefined();
      expect(req.chatTemplateKwargs?.enable_thinking).toBe(true);
      expect(req.extensions?.chat_template_kwargs).toBeDefined();
    });

    test("should preserve chat_template_kwargs in Chat API", () => {
      const req = parseOpenAIRequest({
        model: "gpt-4",
        messages: [{ role: "user", content: "Hello" }],
        chat_template_kwargs: {
          enable_thinking: true,
        },
      }, {
        sourceFormat: "openai",
        endpoint: "/v1/chat/completions",
        headers: {},
        requestId: "test-123",
        timestamp: "2024-01-01T00:00:00Z",
      });

      expect(req.chatTemplateKwargs).toBeDefined();
      expect(req.chatTemplateKwargs?.enable_thinking).toBe(true);
    });

    test("should output chat_template_kwargs when converting to OpenAI request", () => {
      const internal: InternalRequest = {
        model: "test",
        messages: [{ role: "user", content: "Hello" }],
        chatTemplateKwargs: {
          enable_thinking: true,
        },
        metadata: {
          sourceFormat: "openai",
          endpoint: "/v1/chat/completions",
          headers: {},
          requestId: "test-123",
          timestamp: "2024-01-01T00:00:00Z",
        },
      };

      const openaiReq = toOpenAIRequest(internal);

      expect(openaiReq.chat_template_kwargs).toBeDefined();
      expect(openaiReq.chat_template_kwargs?.enable_thinking).toBe(true);
    });

    test("should preserve enable_thinking=false correctly", () => {
      const req = parseOpenAIResponsesRequest({
        model: "gpt-4o",
        input: "Hello",
        chat_template_kwargs: {
          enable_thinking: false,
        },
      }, {
        sourceFormat: "openai-responses",
        endpoint: "/v1/responses",
        headers: {},
        requestId: "test-123",
        timestamp: "2024-01-01T00:00:00Z",
      });

      expect(req.chatTemplateKwargs?.enable_thinking).toBe(false);
    });
  });

  // ============================================================================
  // Stream Parameter Preservation Tests
  // ============================================================================

  describe("stream parameter preservation", () => {
    test("should preserve stream=true in Responses API", () => {
      const req = parseOpenAIResponsesRequest({
        model: "gpt-4o",
        input: "Hello",
        stream: true,
      }, {
        sourceFormat: "openai-responses",
        endpoint: "/v1/responses",
        headers: {},
        requestId: "test-123",
        timestamp: "2024-01-01T00:00:00Z",
      });

      expect(req.stream).toBe(true);
    });

    test("should preserve stream=true in Completions API", () => {
      const req = parseOpenAICompletionRequest({
        model: "gpt-3.5-turbo-instruct",
        prompt: "Hello",
        stream: true,
      }, {
        sourceFormat: "openai-completions",
        endpoint: "/v1/completions",
        headers: {},
        requestId: "test-123",
        timestamp: "2024-01-01T00:00:00Z",
      });

      expect(req.stream).toBe(true);
    });

    test("should output stream parameter when converting to OpenAI request", () => {
      const internal: InternalRequest = {
        model: "test",
        messages: [{ role: "user", content: "Hello" }],
        stream: true,
        metadata: {
          sourceFormat: "openai-completions",
          endpoint: "/v1/completions",
          headers: {},
          requestId: "test-123",
          timestamp: "2024-01-01T00:00:00Z",
        },
      };

      const openaiReq = toOpenAIRequest(internal);

      expect(openaiReq.stream).toBe(true);
    });
  });
});
