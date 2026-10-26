import { expect } from 'vitest';
import { ContractError, NotImplementedError } from '../../src/shared/errors';
import type { ErrorCodeType } from '../../src/dto';

/**
 * Asserts that `promise` rejects with the typed error of the catalog.
 * A NotImplementedError is re-thrown untouched so the red test fails visibly because the stub is not implemented,
 * never because of a typo in the expectation.
 */
export async function expectContractError(
  promise: Promise<unknown>,
  spec: { code: ErrorCodeType; http: number; retryable: boolean },
): Promise<ContractError> {
  let caught: unknown;
  try {
    await promise;
  } catch (e) {
    caught = e;
  }
  if (caught instanceof NotImplementedError) throw caught;
  expect(caught, `expected rejection with ${spec.code}`).toBeInstanceOf(ContractError);
  const err = caught as ContractError;
  expect(err.body.error_code).toBe(spec.code);
  expect(err.body.http_status).toBe(spec.http);
  expect(err.body.retryable).toBe(spec.retryable);
  expect(err.body.message.length).toBeGreaterThan(0);
  return err;
}
