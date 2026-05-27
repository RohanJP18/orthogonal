import { trace, type Tracer } from "@opentelemetry/api";

// All spans in this service use a single tracer named after the service.
// The SDK (configured in instrumentation.ts) routes spans to the configured exporter.
export function getTracer(): Tracer {
  return trace.getTracer("orthogonal-chat", process.env.npm_package_version ?? "0.0.0");
}
