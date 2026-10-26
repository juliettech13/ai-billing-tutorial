import { createPolar } from "@polar-sh/sdk/2026-10";
import { generateText, gateway } from "ai";

const modelId = "nvidia/nemotron-3.5-lightning-free";

const polar = createPolar({
  accessToken: process.env.POLAR_ACCESS_TOKEN!,
  environment: "sandbox",
});

export async function POST(req: Request) {
  const { prompt } = await req.json();
  const { text, usage } = await generateText({
    model: gateway(modelId as Parameters<typeof gateway>[0]),
    prompt,
  });

  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;

  await polar.events.ingest({
    events: [
      {
        name: "llm.completion",
        external_customer_id: "user_123",
        metadata: {
          model: modelId,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          _cost: { amount: 0.4, currency: "usd" },
        },
      },
    ],
  });

  return Response.json({ text });
}
