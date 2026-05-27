import Portkey from "portkey-ai";
import { withCircuitBreaker } from "@/lib/resilience/circuit-breaker";
import { getTracer } from "@/lib/telemetry/tracer";
import { SpanStatusCode } from "@opentelemetry/api";
import type OpenAI from "openai";

// Primary and fallback models — Portkey routes between them automatically
export const DEFAULT_MODEL = "gpt-4.1-mini";
export const FALLBACK_MODEL = "gpt-4o-mini";

// Portkey config: fallback strategy using virtual keys (credentials stored in Portkey vault,
// never transmitted in request headers). Slug "openai-key" is the virtual key configured
// in the Portkey dashboard pointing to the OpenAI API key.
const GATEWAY_CONFIG = {
  strategy: { mode: "fallback" },
  targets: [
    {
      virtual_key: "openai-key",
      override_params: { model: DEFAULT_MODEL },
    },
    {
      virtual_key: "openai-key",
      override_params: { model: FALLBACK_MODEL },
    },
  ],
};

let _client: Portkey | null = null;

function getClient(): Portkey {
  if (!_client) {
    _client = new Portkey({
      apiKey: process.env.PORTKEY_API_KEY!,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      config: GATEWAY_CONFIG as any,
    });
  }
  return _client;
}

// Single entry point for all LLM streaming calls.
// The circuit breaker wraps the entire Portkey call; Portkey handles primary→fallback routing internally.
export async function gatewayCreateStream(
  messages: OpenAI.ChatCompletionMessageParam[],
  tools: OpenAI.ChatCompletionTool[]
): Promise<AsyncIterable<OpenAI.ChatCompletionChunk>> {
  return getTracer().startActiveSpan("llm.call", async (span) => {
    span.setAttributes({
      "llm.primary_model": DEFAULT_MODEL,
      "llm.fallback_model": FALLBACK_MODEL,
      "llm.message_count": messages.length,
      "llm.tool_count": tools.length,
      "llm.streaming": true,
    });
    const start = Date.now();
    try {
      const stream = await withCircuitBreaker("llm", () =>
        getClient().chat.completions.create({
          messages,
          tools,
          tool_choice: "auto",
          stream: true,
          stream_options: { include_usage: true },
          // Model intentionally omitted — Portkey override_params controls routing
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any)
      );
      const latencyMs = Date.now() - start;
      span.setAttributes({ "llm.stream_open_latency_ms": latencyMs });
      span.setStatus({ code: SpanStatusCode.OK });
      console.log(`[gateway] stream opened latency=${latencyMs}ms`);
      // Span ends when the stream is opened, not when it finishes —
      // streaming duration is not attributable to a single span without wrapping the iterator.
      span.end();
      return stream as unknown as AsyncIterable<OpenAI.ChatCompletionChunk>;
    } catch (err) {
      const latencyMs = Date.now() - start;
      span.setAttributes({ "llm.stream_open_latency_ms": latencyMs });
      span.recordException(err instanceof Error ? err : new Error(String(err)));
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
      span.end();
      console.error(`[gateway] failed latency=${latencyMs}ms`, err instanceof Error ? err.message : String(err));
      throw err;
    }
  });
}
