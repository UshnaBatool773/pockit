import { z } from "zod";

export const envelopeCreateSchema = z.object({
  name: z.string().trim().min(1).max(60),
  budget: z.number().finite().nonnegative(),
  amount: z.number().finite().nonnegative().default(0),
  color: z.string().trim().max(20).optional(),
  icon: z.string().trim().max(40).optional(),
});

export const envelopeUpdateSchema = envelopeCreateSchema.partial();

export const envelopeAdjustSchema = z.object({
  // positive = add money, negative = spend
  delta: z.number().finite(),
});

export const transactionCreateSchema = z.object({
  envelope_id: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  amount: z.number().finite(), // negative = debit, positive = credit
  occurred_at: z.string().datetime().optional(),
});

export const vaultCreateSchema = z.object({
  site: z.string().trim().min(1).max(120),
  username: z.string().trim().min(1).max(200),
  password: z.string().min(1).max(2000),
  category: z.string().trim().min(1).max(40).default("Other"),
});

export const vaultUpdateSchema = vaultCreateSchema.partial();

// 4-6 digit PIN, digits only (matches the frontend's PIN pad).
const pinString = z
  .string()
  .regex(/^\d{4,6}$/, "PIN must be 4 to 6 digits");

export const vaultPinSetSchema = z.object({
  pin: pinString,
  currentPin: pinString.optional(),
});

export const vaultPinVerifySchema = z.object({
  pin: pinString,
});

export const uuidParamSchema = z.object({
  id: z.string().uuid(),
});
