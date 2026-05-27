import { getTracer } from "@/lib/telemetry/tracer";
import { SpanStatusCode } from "@opentelemetry/api";

const ORTHOGONAL_BASE_URL = "https://api.orthogonal.com/v1";

// Per-API fetch timeout in ms (web search can be slow)
const FETCH_TIMEOUT: Record<string, number> = {
  scrapegraphai: 60_000,
};

export interface OrthogonalRunParams {
  api: string;
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
}

export interface OrthogonalResponse<T = unknown> {
  data: T;
  priceCents: number;
  requestId: string;
}

export class OrthogonalError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "OrthogonalError";
  }
}

export async function runOrthogonal<T = unknown>(
  params: OrthogonalRunParams
): Promise<OrthogonalResponse<T>> {
  return getTracer().startActiveSpan("orthogonal.run", async (span) => {
    span.setAttributes({
      "orthogonal.api": params.api,
      "orthogonal.path": params.path,
    });

    const apiKey = process.env.ORTHOGONAL_API_KEY;
    if (!apiKey) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: "ORTHOGONAL_API_KEY is not set" });
      span.end();
      throw new OrthogonalError("ORTHOGONAL_API_KEY is not set");
    }

    const url = `${ORTHOGONAL_BASE_URL}/run`;

    const requestBody: Record<string, unknown> = {
      api: params.api,
      path: params.path,
    };
    if (params.query) requestBody.query = params.query;
    if (params.body) requestBody.body = params.body;

    const timeoutMs = FETCH_TIMEOUT[params.api] ?? 30_000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    console.log(`[orthogonal] → api=${params.api} path=${params.path}`, params.query ?? params.body ?? "");

    let response: Response;
    const start = Date.now();
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      const latencyMs = Date.now() - start;
      span.setAttributes({ "orthogonal.latency_ms": latencyMs });
      span.recordException(err instanceof Error ? err : new Error(String(err)));
      span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
      span.end();
      throw new OrthogonalError(
        `Network error calling Orthogonal: ${(err as Error).message}`
      );
    } finally {
      clearTimeout(timeoutId);
    }

    const latencyMs = Date.now() - start;
    const json = await response.json();

    if (!response.ok) {
      span.setAttributes({
        "orthogonal.http_status": response.status,
        "orthogonal.latency_ms": latencyMs,
      });
      span.setStatus({ code: SpanStatusCode.ERROR, message: `HTTP ${response.status}` });
      span.end();
      throw new OrthogonalError(
        `Orthogonal returned ${response.status}`,
        response.status,
        json
      );
    }

    if (!json.success) {
      span.setAttributes({ "orthogonal.latency_ms": latencyMs });
      span.setStatus({ code: SpanStatusCode.ERROR, message: json.error ?? "unknown error" });
      span.end();
      throw new OrthogonalError(
        `Orthogonal call failed: ${json.error ?? "unknown error"}`,
        undefined,
        json
      );
    }

    span.setAttributes({
      "orthogonal.http_status": response.status,
      "orthogonal.latency_ms": latencyMs,
      "orthogonal.price_cents": json.priceCents ?? 0,
      "orthogonal.request_id": json.requestId ?? "",
    });
    span.setStatus({ code: SpanStatusCode.OK });
    span.end();

    console.log(`[orthogonal] ← api=${params.api} status=${response.status} priceCents=${json.priceCents ?? 0} requestId=${json.requestId ?? ""}`);

    return {
      data: json.data as T,
      priceCents: json.priceCents ?? 0,
      requestId: json.requestId ?? "",
    };
  });
}

export interface ToolExecuteOptions {
  bypassCache?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
  execute: (params: Record<string, unknown>, opts?: ToolExecuteOptions) => Promise<OrthogonalResponse<unknown>>;
}

export interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: ToolDefinition["parameters"];
  };
  execute: ToolDefinition["execute"];
}

export function buildTool(def: ToolDefinition): OpenAITool {
  return {
    type: "function",
    function: {
      name: def.name,
      description: def.description,
      parameters: def.parameters,
    },
    execute: def.execute,
  };
}
