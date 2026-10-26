import type { MetricBatchDTO, IngestionResultDTO } from '../../dto';

/** contracts.md Operation 1. Rejects with ContractError carrying an ErrorBodyDTO. */
export interface TelemetryIngestionPort {
  ingestMetricBatch(batch: MetricBatchDTO): Promise<IngestionResultDTO>;
}
