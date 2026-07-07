import { Activity, Code2, Gauge, RefreshCw, Workflow as WorkflowIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { AppRecord, BackendApi, UsageSummary, UsageTimeseriesPoint } from "../api";
import { EmptyTableRow, MetricCard, PageIntro, Panel, StatusPill } from "../components/console";
import { errorMessage } from "../utils/format";

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
      showToast(errorMessage(cause, "Unable to load usage metrics"));
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, app?.id]);

  return (
    <div className="page-grid">
      <PageIntro
        title="Usage and operational signal"
        description="Track whether Mia is being used, whether workflows run, and whether provider calls are healthy for the selected app."
        action={<button className="button secondary small" type="button" onClick={() => void load()}><RefreshCw size={14} />Refresh</button>}
      >
        <StatusPill tone={summary.totals.errors > 0 ? "red" : "green"} label={`${summary.totals.errors} errors`} />
      </PageIntro>
      <section className="metric-grid">
        <MetricCard label="SDK events" value={String(summary.totals.sdkEvents)} detail="Execution log events" icon={Activity} />
        <MetricCard label="Workflow runs" value={String(summary.totals.workflowRuns)} detail="Workflow-prefixed events" icon={WorkflowIcon} />
        <MetricCard label="AI requests" value={String(summary.totals.aiRequests)} detail="Provider request logs" icon={Code2} />
        <MetricCard label="Mean AI latency" value={summary.totals.averageAiLatencyMs === null ? "n/a" : `${summary.totals.averageAiLatencyMs} ms`} detail={`${summary.totals.errors} errors`} icon={Gauge} />
      </section>

      <section className="two-column">
        <Panel title="Event mix">
          <div className="usage-bar-list">
            {summary.eventCounts.length === 0 && <div className="empty-state">No execution events yet.</div>}
            {summary.eventCounts.map((item) => (
              <UsageBar key={item.eventType} label={item.eventType} value={item.count} max={Math.max(...summary.eventCounts.map((event) => event.count), 1)} />
            ))}
          </div>
        </Panel>

        <Panel title="Provider calls">
          <div className="usage-bar-list">
            {summary.providerCounts.length === 0 && <div className="empty-state">No AI provider logs yet.</div>}
            {summary.providerCounts.map((item) => (
              <UsageBar key={item.provider} label={item.provider} value={item.count} max={Math.max(...summary.providerCounts.map((provider) => provider.count), 1)} />
            ))}
          </div>
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

function UsageBar({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <div className="usage-bar-row">
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <div className="usage-bar-track" aria-hidden="true">
        <span style={{ width: `${Math.max(4, Math.round((value / max) * 100))}%` }} />
      </div>
    </div>
  );
}
