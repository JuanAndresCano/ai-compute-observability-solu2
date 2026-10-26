import type { FleetSnapshotDTO } from '../../dto';

/** AD-01: the only path from the ingestion worker to the UI thread; called at most 4 times per second. */
export interface UiDispatchPort {
  dispatch(snapshot: FleetSnapshotDTO): void;
}
