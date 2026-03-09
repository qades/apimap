import { describe, test, expect } from "bun:test";
import { getFormatCapabilities, type ProviderFormat } from "./internal.ts";

describe("Internal Types", () => {
  describe("getFormatCapabilities", () => {
    test("should return correct capabilities for anthropic format", () => {
      const caps = getFormatCapabilities("anthropic");
      expect(caps.supportsSystemMessage).toBe(true);
      expect(caps.supportsTools).toBe(true);
      expect(caps.supportsStreaming).toBe(true);
      expect(caps.supportsImages).toBe(true);
      expect(caps.separateSystemField).toBe(true);
      expect(caps.toolChoiceStyle).toBe("anthropic");
      expect(caps.messageContentStyle).toBe("array");
    });

    test("should return correct capabilities for openai format", () => {
      const caps = getFormatCapabilities("openai");
      expect(caps.supportsSystemMessage).toBe(true);
      expect(caps.supportsTools).toBe(true);
      expect(caps.supportsStreaming).toBe(true);
      expect(caps.supportsImages).toBe(true);
      expect(caps.separateSystemField).toBe(false);
      expect(caps.toolChoiceStyle).toBe("openai");
      expect(caps.messageContentStyle).toBe("both");
    });

    test("should return correct capabilities for ollama format", () => {
      const caps = getFormatCapabilities("ollama");
      expect(caps.supportsSystemMessage).toBe(true);
      expect(caps.supportsTools).toBe(false);
      expect(caps.supportsStreaming).toBe(true);
      expect(caps.supportsImages).toBe(true);
      expect(caps.separateSystemField).toBe(false);
      expect(caps.toolChoiceStyle).toBe("simple");
      expect(caps.messageContentStyle).toBe("string");
    });

    test("should return default capabilities for unknown format", () => {
      const caps = getFormatCapabilities("unknown" as ProviderFormat);
      expect(caps.supportsSystemMessage).toBe(true);
      expect(caps.supportsTools).toBe(false);
      expect(caps.supportsStreaming).toBe(true);
    });
  });
});
