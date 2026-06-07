import type { Repositories, UsageSummary, UsageTimeseriesPoint } from "../../db/repositories.js";

export class UsageService {
  constructor(private readonly repositories: Repositories) {}

  summary(filters: { appId?: string; from?: string; to?: string }): UsageSummary {
    return this.repositories.getUsageSummary(filters);
  }

  timeseries(filters: { appId?: string; from?: string; to?: string; bucket?: "day" }): UsageTimeseriesPoint[] {
    return this.repositories.getUsageTimeseries(filters);
  }
}
