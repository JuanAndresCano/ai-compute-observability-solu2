import type { MetricBatchDTO, IngestionResultDTO } from '../../dto';
import type { TelemetryIngestionPort } from '../../ports/in/telemetry-ingestion.port';
import { NotImplementedError } from '../../shared/errors';
import type { Deps } from '../../composition';

export class TelemetryIngestionService implements TelemetryIngestionPort {
  constructor(_deps: Deps) {}
  async ingestMetricBatch(_batch: MetricBatchDTO): Promise<IngestionResultDTO> {
    throw new NotImplementedError('TelemetryIngestionService.ingestMetricBatch');
  }
}
