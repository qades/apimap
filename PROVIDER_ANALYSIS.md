# Provider Parameter Analysis

Based on analysis of litellm-router's 100+ provider implementations.

## Parameter Frequency (across all providers)

| Parameter | Frequency | Category |
|-----------|-----------|----------|
| stream | 31 | Core |
| max_tokens | 29 | Core |
| temperature | 28 | Core |
| top_p | 27 | Core |
| stop | 22 | Core |
| max_completion_tokens | 21 | Core |
| tools | 18 | Core |
| tool_choice | 17 | Core |
| response_format | 17 | Core |
| presence_penalty | 16 | Standard |
| frequency_penalty | 15 | Standard |
| n | 14 | Standard |
| seed | 9 | Standard |
| functions | 8 | Legacy |
| stream_options | 7 | Standard |
| logprobs | 7 | Standard |
| logit_bias | 6 | Advanced |
| function_call | 6 | Legacy |
| top_logprobs | 5 | Advanced |
| parallel_tool_calls | 5 | Advanced |
| extra_headers | 5 | Passthrough |
| reasoning_effort | 4 | Provider-specific |
| user | 3 | Metadata |
| thinking | 2 | Provider-specific |
| modalities | 1 | Advanced |
| prediction | 1 | Advanced |
| web_search_options | 3 | Provider-specific |
| top_k | 1 | Provider-specific |
| repetition_penalty | 1 | Provider-specific |

## Provider-Specific Parameters

### Anthropic
- `thinking` (with budget_tokens)
- `cache_control` (prompt caching)
- `anthropic_beta`
- `anthropic_version`

### DeepSeek
- `thinking` (different format than Anthropic)
- `chat_template_kwargs`

### Gemini
- `web_search_options`
- `modalities`

### vLLM/TGI/etc
- `top_k`
- `repetition_penalty`
- `min_p`
- `truncate`

## Response Fields

### Common
- `id`
- `model`
- `choices`
- `usage` (prompt_tokens, completion_tokens, total_tokens)
- `created`

### Optional/Provider-specific
- `system_fingerprint` (OpenAI)
- `logprobs` (OpenAI, Gemini)
- `reasoning_content` (DeepSeek, etc)
- `cache_creation_input_tokens` (Anthropic)
- `cache_read_input_tokens` (Anthropic)
