import { z } from 'zod';

const TruckSchema = z.object({
  id: z.string().min(1, 'Truck ID is required'),
  max_weight_lbs: z.number().positive('Max weight must be positive'),
  max_volume_cuft: z.number().positive('Max volume must be positive'),
});

const OrderSchema = z.object({
  id: z.string().min(1, 'Order ID is required'),
  payout_cents: z.number().int('Payout must be integer cents').nonnegative('Payout cannot be negative'),
  weight_lbs: z.number().positive('Weight must be positive'),
  volume_cuft: z.number().positive('Volume must be positive'),
  origin: z.string().min(1, 'Origin is required'),
  destination: z.string().min(1, 'Destination is required'),
  pickup_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  delivery_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  is_hazmat: z.boolean(),
});

export const OptimizeRequestSchema = z.object({
  truck: TruckSchema,
  orders: z.array(OrderSchema).max(30, 'Maximum 30 orders allowed'),
  revenue_weight: z.number().min(0).max(1).optional(),
  utilization_weight: z.number().min(0).max(1).optional(),
});

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; errors: string[] };

export function validateOptimizeRequest(body: unknown): ValidationResult<z.infer<typeof OptimizeRequestSchema>> {
  const result = OptimizeRequestSchema.safeParse(body);

  if (result.success) {
    return { success: true, data: result.data };
  }

  const errors = result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
  return { success: false, errors };
}

export function validateDateConstraints(orders: { id: string; pickup_date: string; delivery_date: string }[]): string[] {
  const errs: string[] = [];

  for (const o of orders) {
    const pickup = new Date(o.pickup_date);
    const delivery = new Date(o.delivery_date);

    if (pickup > delivery) {
      errs.push(`Order ${o.id}: pickup_date cannot be after delivery_date`);
    }
  }

  return errs;
}

export function validateUniqueOrderIds(orders: { id: string }[]): string[] {
  const seen = new Set<string>();
  const dupes: string[] = [];

  for (const o of orders) {
    if (seen.has(o.id)) {
      dupes.push(o.id);
    }
    seen.add(o.id);
  }

  if (dupes.length > 0) {
    return [`Duplicate order IDs: ${dupes.join(', ')}`];
  }
  return [];
}
