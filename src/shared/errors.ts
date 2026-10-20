/** Thrown by every interface stub. The ATDD suite must fail with this error until real code exists. */
export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`NotImplementedError: ${what}`);
    this.name = 'NotImplementedError';
  }
}

/** Raised by a repository port when the storage engine fails (maps to ERR_DATABASE_UNAVAILABLE, 503). */
export class StorageUnavailableError extends Error {
  constructor(message = 'storage engine unavailable') {
    super(message);
    this.name = 'StorageUnavailableError';
  }
}

import type { ErrorBodyDTO } from '../dto';

/** Contract failure: carries the typed ErrorBodyDTO of the Typed Error Catalog (contracts.md section 2). */
export class ContractError extends Error {
  constructor(public readonly body: ErrorBodyDTO) {
    super(`${body.error_code}: ${body.message}`);
    this.name = 'ContractError';
  }
}
