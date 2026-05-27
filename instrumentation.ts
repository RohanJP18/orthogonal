// Next.js automatically calls register() from this file on server start.
// See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { NodeSDK } = await import("@opentelemetry/sdk-node");
    const { OTLPTraceExporter } = await import(
      "@opentelemetry/exporter-trace-otlp-http"
    );
    const { resourceFromAttributes } = await import("@opentelemetry/resources");
    const { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_SERVICE_VERSION } =
      await import("@opentelemetry/semantic-conventions");
    const { BatchSpanProcessor } = await import(
      "@opentelemetry/sdk-trace-node"
    );
    const { diag, DiagConsoleLogger, DiagLogLevel } = await import(
      "@opentelemetry/api"
    );

    if (process.env.OTEL_DEBUG === "true") {
      diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
    }

    // OTEL_EXPORTER_OTLP_ENDPOINT defaults to http://localhost:4318.
    // Set it in .env.local to point at Grafana / Datadog / Honeycomb / etc.
    const endpoint =
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
      "http://localhost:4318/v1/traces";

    const headers = process.env.OTEL_EXPORTER_OTLP_HEADERS
      ? Object.fromEntries(
          process.env.OTEL_EXPORTER_OTLP_HEADERS.split(",").map((h) => {
            const [k, ...v] = h.split("=");
            return [k.trim(), v.join("=").trim()];
          })
        )
      : {};

    const exporter = new OTLPTraceExporter({ url: endpoint, headers });

    const sdk = new NodeSDK({
      resource: resourceFromAttributes({
        [SEMRESATTRS_SERVICE_NAME]: "orthogonal-chat",
        [SEMRESATTRS_SERVICE_VERSION]:
          process.env.npm_package_version ?? "0.0.0",
        "deployment.environment": process.env.NODE_ENV ?? "development",
      }),
      // BatchSpanProcessor buffers and flushes every 5 s or 512 spans —
      // never blocks the hot path the way SimpleSpanProcessor would.
      spanProcessors: [new BatchSpanProcessor(exporter)],
    });

    sdk.start();
    console.log(`[otel] SDK started — exporter=${endpoint}`);
  }
}
