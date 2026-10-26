import type { ReportQueryDTO, ExecutiveReportDTO } from '../../dto';
import type { ReportingPort } from '../../ports/in/reporting.port';
import { NotImplementedError } from '../../shared/errors';
import type { Deps } from '../../composition';

export class ReportingService implements ReportingPort {
  constructor(_deps: Deps) {}
  async buildUtilizationReport(_query: ReportQueryDTO): Promise<ExecutiveReportDTO> {
    throw new NotImplementedError('ReportingService.buildUtilizationReport');
  }
}
