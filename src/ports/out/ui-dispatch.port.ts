export interface UiTick {
  bucket_start_ms: number; // start of the closed 250 ms window
  series_count: number;    // GPU series summarised in this dispatch (<= 33)
}

/** AD-01: the only path from the ingestion worker to the UI thread; called at most 4 times per second. */
export interface UiDispatchPort {
  dispatch(tick: UiTick): void;
}
