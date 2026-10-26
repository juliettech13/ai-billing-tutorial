# Bill an AI app with Polar

Build a small research assistant that charges for output tokens. You can use this as a template to build your own AI app that charges for output tokens.

By the end a customer can check out in sandbox, your server receives the webhook, and records usage for billing using a [sandbox organization](https://sandbox.polar.sh/start).

---

## 1. Create the app and install dependencies

```bash
npx create-next-app@latest margin --ts --app --eslint --use-pnpm --yes
cd margin
pnpm add @polar-sh/sdk @polar-sh/nextjs ai
```

Create `.env.local`:

```bash
POLAR_ACCESS_TOKEN=polar_oat_...
POLAR_ENVIRONMENT=sandbox
SUCCESS_URL=http://localhost:3000/success?checkout_id={CHECKOUT_ID}
AI_GATEWAY_API_KEY=...
```

`POLAR_ACCESS_TOKEN` is an [organization access token](https://polar.sh/docs/integrate/oat) from the sandbox org. You will create it in the next step.

`AI_GATEWAY_API_KEY` is a [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) key. The chat route uses a [free model](https://vercel.com/ai-gateway/models).

```bash
pnpm dev
```

Use the port Next prints, i.e `http://localhost:3000`. If Next prints another port, use that port in every URL below. Restart `pnpm dev` after every change to `.env.local`.

---

## 2. Create a sandbox token

1. Open [sandbox.polar.sh/start](https://sandbox.polar.sh/start) and create an organization. You land in the sandbox dashboard.
2. In the left sidebar, open **Settings** and scroll to **Developers**. Click **New Token**. The section is near the bottom of the page.
3. Copy the token. It starts with `polar_oat_`. Put it in `.env.local` as `POLAR_ACCESS_TOKEN`.

The Next.js routes in this tutorial pass `environment: "sandbox"`. A production token will not work against sandbox.

---

## 3. Define the catalog in `polar.config.ts`

[Usage-based billing](https://polar.sh/docs/features/usage-based-billing/introduction) is a [meter](https://polar.sh/docs/features/usage-based-billing/meters), [credits](https://polar.sh/docs/features/benefits/credits) on that meter, and [prices on products](https://polar.sh/docs/features/products). This step writes all three in `polar.config.ts` and applies that file. After apply, the dashboard will not save catalog edits. If you change the file and run `polar config apply` again.

-- `@polar-sh/polar` is not on npm yet, and `polar config` is a preview command. So we'll need to clone Polar outside your app, build that package, and run the preview CLI from the clone. The Next app stays in `margin/`. You need [Node 22+](https://nodejs.org) and [Bun 1.4](https://bun.sh/docs/installation).

```bash
git clone https://github.com/polarsource/polar.git ~/polar
cd ~/polar/clients
pnpm install
pnpm --filter @polar-sh/polar build
```

Add this to `~/.zshrc`, then run `source ~/.zshrc`. The [published CLI](https://polar.sh/docs/integrate/cli/introduction) hides `polar config` until `POLAR_PREVIEW=1` is set in the shell. This function is the preview build. Bun loads `.env.local` from the directory you run it in.

```bash
polar() { POLAR_PREVIEW=1 bun ~/polar/clients/packages/cli/src/cli.ts "$@"; }
```

Back in `margin`:

```bash
pnpm add ~/polar/clients/packages/polar zod
```

`polar.config.ts` in the root of `margin`:

```ts
import { defineConfig, perMillion, usd } from '@polar-sh/polar'
import { z } from 'zod'

export default defineConfig({
  events: {
    'llm.completion': z.object({
      model: z.string(),
      input_tokens: z.int(),
      output_tokens: z.int()
    })
  },
  meters: ({ meter, events }) => ({
    output_tokens: meter('Output tokens')
      .on(events['llm.completion'])
      .unit('token')
      .sum('output_tokens')
  }),
  benefits: ({ credits }) => ({
    free_tokens: credits('Free tokens').meter('output_tokens').units(50_000),
    topup_1m: credits('1M extra tokens')
      .meter('output_tokens')
      .units(1_000_000)
      .rollover()
  }),
  products: ({ product, free, fixed, meter }) => ({
    free: product('Free')
      .prices(free())
      .recurring('monthly')
      .grants(['free_tokens']),
    pro: product('Pro')
      .prices(
        fixed().amount(usd(20)),
        meter('output_tokens').flat().amount(perMillion(usd(3)))
      )
      .recurring('monthly'),
    topup_1m: product('Top-up 1M tokens')
      .prices(fixed().amount(usd(9)))
      .once()
      .grants(['topup_1m'])
  })
})
```

This file creates these rows in your Product dashboard:

| Sidebar | Name | What it is |
|---|---|---|
| **Products → Catalogue** | Free | $0 every month. Grants 50,000 output tokens. |
| **Products → Catalogue** | Pro | $20 every month, plus 3 per 1M output tokens on the next invoice. |
| **Products → Catalogue** | Top-up 1M tokens | $9 once. Grants 1,000,000 output tokens. Unused tokens roll over. |
| **Products → Meters** | Output tokens | Sums `output_tokens` on events named `llm.completion`. |
| **Products → Benefits** | Free tokens | 50,000 units on the Output tokens meter. |
| **Products → Benefits** | 1M extra tokens | 1,000,000 units on that meter, with rollover. |

In your terminal:

```bash
polar config plan
polar config apply
```

- `plan` prints a diff and creates nothing.
- `apply` creates the meter, the benefits, and the products.
- [Authentication](https://polar.sh/docs/integrate/cli/authentication) is the token in `.env.local`. Do not run `polar auth login` while that variable is set and make sure the environment is set to sandbox.

In the sandbox dashboard, open **Products → Catalogue** and confirm Free, Pro, and Top-up 1M tokens are listed.

To change a price, edit the file. Set Pro's usage price to `usd(2.5)`, then run `polar config plan`. You should see one change. `polar config apply` writes it. Existing subscribers stay on the price they bought. New checkouts use the new amount.

---

## 4. Open checkout

Create `app/checkout/route.ts` with the following content:

```ts
import { Checkout } from "@polar-sh/nextjs"

export const GET = Checkout({
  accessToken: process.env.POLAR_ACCESS_TOKEN!,
  successUrl: process.env.SUCCESS_URL,
  returnUrl: "http://localhost:3000",
  environment: "sandbox",
  theme: "dark"
})
```

`successUrl` must be an absolute URL. The handler adds `checkout_id={CHECKOUT_ID}` unless you pass `includeCheckoutId: false`.

Find the product id in the product URL of your sandbox. For example, the Pro product URL is https://sandbox.polar.sh/dashboard/your-org/products/3290000-0000-0000-0000-00000000000. The product id is `3290000-0000-0000-0000-00000000000`.

Then, open the checkout page:

```text
http://localhost:3000/checkout?products=<pro product id>&external_customer_id=user_123
```

Do not pay yet. The next step listens for the webhook first.

---

## 5. Receive the webhook

In your terminal:

```bash
polar webhook listen http://localhost:3000/api/webhook/polar
```

Copy the `Secret` line into `.env.local` as `POLAR_WEBHOOK_SECRET`, restart `pnpm dev`, and leave the listener running. [Webhooks on your machine](https://polar.sh/docs/integrate/cli/webhooks) shows the same banner.

Create `app/api/webhook/polar/route.ts` with the following content:

```ts
import { Webhooks } from "@polar-sh/nextjs"

export const POST = Webhooks({
  webhookSecret: process.env.POLAR_WEBHOOK_SECRET!,
  onPayload: async (payload) => {
    console.log("[polar]", payload.type)
  }
})
```

In a second terminal:

```bash
polar webhook trigger customer.state_changed
```

The listener should print `200`. The Next terminal should print `[polar] customer.state_changed`.

-- *A `404` whose body is an "Action Controller" page means the listener is pointed at some other server on that port. Use the port Next printed.*

Now, purchase Pro with the fake `4242…` card number on the checkout page and your own email and a Berlin billing address.

The listener shows `customer.state_changed` with `200`, and the receipt arrives. In the dashboard, the order is under **Sales → Orders** and the subscription is under **Sales → Subscriptions**. Open **Customers** and click that customer. **External ID** should be `user_123`. A Berlin billing address shows VAT on the order. Polar calculates and collects it.

---

## 6. Open the customer portal

Create `app/portal/route.ts` with the following content:

```ts
import { CustomerPortal } from "@polar-sh/nextjs"

export const GET = CustomerPortal({
  accessToken: process.env.POLAR_ACCESS_TOKEN!,
  getExternalCustomerId: async () => "user_123",
  returnUrl: "http://localhost:3000",
  environment: "sandbox"
})
```

Open `http://localhost:3000/portal`. You should see the Pro subscription. That page is what the customer sees. The same subscription is under **Sales → Subscriptions** in the dashboard.

---

## 7. Record token usage

Call the model, then send the token counts as numbers with [event ingestion](https://polar.sh/docs/features/usage-based-billing/event-ingestion).

Create `app/api/chat/route.ts` with the following content:

```ts
import { createPolar } from "@polar-sh/sdk/2026-10"
import { generateText, gateway } from "ai"

const modelId = "nvidia/nemotron-3.5-lightning-free"

const polar = createPolar({
  accessToken: process.env.POLAR_ACCESS_TOKEN!,
  environment: "sandbox"
})

export async function POST(req: Request) {
  const { prompt } = await req.json()
  const { text, usage } = await generateText({
    model: gateway(modelId as Parameters<typeof gateway>[0]),
    prompt
  })

  const inputTokens = usage.inputTokens ?? 0
  const outputTokens = usage.outputTokens ?? 0

  await polar.events.ingest({
    events: [
      {
        name: "llm.completion",
        external_customer_id: "user_123",
        metadata: {
          model: modelId,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          _cost: { amount: 0.4, currency: "usd" }
        }
      }
    ]
  })

  return Response.json({ text })
}
```

Restart `pnpm dev`, then:

```bash
curl -sS -X POST http://localhost:3000/api/chat \
  -H 'content-type: application/json' \
  -d '{"prompt":"Say hello in one sentence"}'
```

The response has a `text` field. In the dashboard, open **Analytics → Events** and find `llm.completion`. Then open **Products → Meters → Output tokens**. The total should have increased. On the customer page (**Customers**, then `user_123`), the same meter shows that customer's balance.

-- `nvidia/nemotron-3.5-lightning-free` is a $0 model on the [gateway model list](https://vercel.com/ai-gateway/models). Free models allow about 5 requests per minute.

---

## 8. See cost

`_cost` on the event is what [Cost Insights](https://polar.sh/docs/features/cost-insights/introduction) uses. In the dashboard, open **Analytics → Costs**. Cost and profit for `user_123` come from that field.

---

## 9. Optional: ask from an agent

Polar's [MCP server](https://polar.sh/docs/integrate/mcp) uses OAuth. For this sandbox org:

```bash
claude mcp add --transport http polar-sandbox https://mcp.polar.sh/mcp/polar-sandbox
```

Finish with `/mcp`, then ask which customers have a negative meter balance. The production server is `https://mcp.polar.sh/mcp/polar-mcp`. Cursor, Claude Desktop, and ChatGPT are in the same guide.

---

## Not in this setup

| You might go looking for | What to do |
|---|---|
| A customer, a team, and an agent as separate ids | One [External ID](https://polar.sh/docs/features/customer-management#external-id) per customer |
| Polar pauses the model when credits run out | It does not. Your app would have to read the balance and refuse the request |
| Polar reads the AI gateway for you | Send the event yourself, as in step 7 |
| Your own Stripe or Adyen account | Polar is the merchant of record. Sandbox payments use [Stripe test cards](https://docs.stripe.com/testing#cards) |

---

## Docs

- [Introduction](https://polar.sh/docs/introduction)
- [Sandbox](https://polar.sh/docs/integrate/sandbox)
- [Organization access tokens](https://polar.sh/docs/integrate/oat)
- [Next.js guide](https://polar.sh/docs/guides/nextjs)
- [Next.js adapter](https://polar.sh/docs/integrate/sdk/adapters/nextjs)
- [Products](https://polar.sh/docs/features/products)
- [Usage-based billing](https://polar.sh/docs/features/usage-based-billing/introduction)
- [Meters](https://polar.sh/docs/features/usage-based-billing/meters)
- [Credits](https://polar.sh/docs/features/benefits/credits)
- [Event ingestion](https://polar.sh/docs/features/usage-based-billing/event-ingestion)
- [Customer state](https://polar.sh/docs/integrate/customer-state)
- [Cost Insights](https://polar.sh/docs/features/cost-insights/introduction)
- [CLI](https://polar.sh/docs/integrate/cli/introduction)
- [Webhooks on your machine](https://polar.sh/docs/integrate/cli/webhooks)
- [MCP](https://polar.sh/docs/integrate/mcp)
