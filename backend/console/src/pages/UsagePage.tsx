import { Activity, Code2, Gauge, RefreshCw, Workflow as WorkflowIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { AppRecord, BackendApi, UsageSummary, UsageTimeseriesPoint } from "../api";
import { EmptyTableRow, MetricCard, Panel } from "../components/console";

const emptyUsage: UsageSummary = {
  totals: { sdkEvents: 0, workflowRuns: 0, aiRequests: 0, errors: 0, averageAiLatencyMs: null },
  eventCounts: [],
  providerCounts: []
};

export function UsagePage({ app, api, showToast }: { app: AppRecord | null; api: BackendApi; showToast: (message: string) => void }) {
  const [summary, setSummary] = useState<UsageSummary>(emptyUsage);
  const [timeseries, setTimeseries] = useState<UsageTimeseriesPoint[]>([]);

  const load = async () => {
    try {
      const filters = app ? { appId: app.id } : {};
      const [nextSummary, nextTimeseries] = await Promise.all([
        api.usage(filters),
        api.usageTimeseries({ ...filters, bucket: "day" })
      ]);
      setSummary(nextSummary);
      setTimeseries(nextTimeseries.items);
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "Unable to load usage metrics");
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, app?.id]);

  return (
    <div className="page-grid">
      <section className="metric-grid">
        <MetricCard label="SDK events" value={String(summary.totals.sdkEvents)} detail="Execution log events" icon={Activity} />
        <MetricCard label="Workflow runs" value={String(summary.totals.workflowRuns)} detail="Workflow-prefixed events" icon={WorkflowIcon} />
        <MetricCard label="AI requests" value={String(summary.totals.aiRequests)} detail="Provider request logs" icon={Code2} />
        <MetricCard label="Mean AI latency" value={summary.totals.averageAiLatencyMs === null ? "n/a" : `${summary.totals.averageAiLatencyMs} ms`} detail={`${summary.totals.errors} errors`} icon={Gauge} />
      </section>

      <section className="two-column">
        <Panel title="Event counts" action={<button className="button secondary small" type="button" onClick={() => void load()}><RefreshCw size={14} />Refresh</button>}>
          <table>
            <thead>
              <tr>
                <th>Event type</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>
              {summary.eventCounts.length === 0 && <EmptyTableRow colSpan={2} message="No execution events yet." />}
              {summary.eventCounts.map((item) => (
                <tr key={item.eventType}>
                  <td>{item.eventType}</td>
                  <td>{item.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel title="Provider counts">
          <table>
            <thead>
              <tr>
                <th>Provider</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>
              {summary.providerCounts.length === 0 && <EmptyTableRow colSpan={2} message="No AI provider logs yet." />}
              {summary.providerCounts.map((item) => (
                <tr key={item.provider}>
                  <td>{item.provider}</td>
                  <td>{item.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </section>

      <Panel title="Daily usage">
        <table>
          <thead>
            <tr>
              <th>Day</th>
              <th>SDK events</th>
              <th>Workflow runs</th>
              <th>AI requests</th>
              <th>Errors</th>
            </tr>
          </thead>
          <tbody>
            {timeseries.length === 0 && <EmptyTableRow colSpan={5} message="No timeseries data yet." />}
            {timeseries.map((point) => (
              <tr key={point.bucket}>
                <td>{point.bucket}</td>
                <td>{point.sdkEvents}</td>
                <td>{point.workflowRuns}</td>
                <td>{point.aiRequests}</td>
                <td>{point.errors}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
