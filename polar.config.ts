import { defineConfig, perMillion, usd } from "@polar-sh/polar";
import { z } from "zod";

export default defineConfig({
  events: {
    "llm.completion": z.object({
      model: z.string(),
      input_tokens: z.int(),
      output_tokens: z.int(),
    }),
  },
  meters: ({ meter, events }) => ({
    output_tokens: meter("Output tokens")
      .on(events["llm.completion"])
      .unit("token")
      .sum("output_tokens"),
  }),
  benefits: ({ credits }) => ({
    free_tokens: credits("Free tokens").meter("output_tokens").units(50_000),
    topup_1m: credits("1M extra tokens")
      .meter("output_tokens")
      .units(1_000_000)
      .rollover(),
  }),
  products: ({ product, free, fixed, meter }) => ({
    free: product("Free")
      .prices(free())
      .recurring("monthly")
      .grants(["free_tokens"]),
    pro: product("Pro")
      .prices(
        fixed().amount(usd(20)),
        meter("output_tokens")
          .flat()
          .amount(perMillion(usd(3))),
      )
      .recurring("monthly"),
    topup_1m: product("Top-up 1M tokens")
      .prices(fixed().amount(usd(9)))
      .once()
      .grants(["topup_1m"]),
  }),
});
