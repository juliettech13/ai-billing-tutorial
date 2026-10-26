import { CustomerPortal } from "@polar-sh/nextjs";

export const GET = CustomerPortal({
  accessToken: process.env.POLAR_ACCESS_TOKEN!,
  getExternalCustomerId: async () => "user_123",
  returnUrl: "http://localhost:3002",
  environment: "sandbox",
});
