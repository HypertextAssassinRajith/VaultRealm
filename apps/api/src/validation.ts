/**
 * Zod validation helper for route handlers.
 *
 * Uses safeParse to avoid instanceof issues across module boundaries,
 * and returns a consistent 400 error format.
 */

import type { ZodSchema, ZodError } from 'zod';
import type { FastifyReply } from 'fastify';

interface ValidationSuccess<T> {
  success: true;
  data: T;
}

interface ValidationFailure {
  success: false;
}

/**
 * Validate request data with a Zod schema.
 * On failure, sends a 400 response and returns { success: false }.
 * On success, returns { success: true, data }.
 */
export function validate<T>(
  schema: ZodSchema<T>,
  data: unknown,
  reply: FastifyReply,
): ValidationSuccess<T> | ValidationFailure {
  const result = schema.safeParse(data);

  if (!result.success) {
    const messages = (result.error as ZodError).issues.map(
      (i) => `${i.path.join('.')}: ${i.message}`,
    );
    reply.status(400).send({
      code: 'VALIDATION_ERROR',
      message: 'Invalid request data.',
      details: messages,
    });
    return { success: false };
  }

  return { success: true, data: result.data };
}
