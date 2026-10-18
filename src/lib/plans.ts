export const plans = {
  FREE: {
    name: "Free",
    price: 0,
    limit: 10,
    brands: 1,
    schedule: false,
    repurpose: false,
    analytics: false,
  },
  STARTER: {
    name: "Starter",
    price: 29000,
    limit: 100,
    brands: 1,
    schedule: true,
    repurpose: false,
    analytics: false,
  },
  PRO: {
    name: "Pro",
    price: 59000,
    limit: 500,
    brands: 3,
    schedule: true,
    repurpose: true,
    analytics: true,
  },
  AGENCY: {
    name: "Agency",
    price: 149000,
    limit: 2000,
    brands: 20,
    schedule: true,
    repurpose: true,
    analytics: true,
  },
} as const;
export type PlanId = keyof typeof plans;
export function isPlan(value: unknown): value is PlanId {
  return typeof value === "string" && Object.hasOwn(plans, value);
}
