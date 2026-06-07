import { useState } from "react";
import type { ExecutionLog } from "../api";
import { LogTable, Panel } from "../components/console";

export function LogsPage({ logs }: { logs: ExecutionLog[] }) {
  const [eventType, setEventType] = useState("all");
  const filtered = logs.filter((log) => eventType === "all" || log.eventType === eventType);

  return (
    <div className="page-grid">
      <Panel title="Log filters">
        <div className="filter-row">
          <label>
            Event type
            <select value={eventType} onChange={(event) => setEventType(event.target.value)}>
              <option value="all">All events</option>
              {[...new Set(logs.map((log) => log.eventType))].map((item) => (
                <option value={item} key={item}>{item}</option>
              ))}
            </select>
          </label>
        </div>
      </Panel>
      <Panel title="Runtime logs">
        <LogTable logs={filtered} />
      </Panel>
    </div>
  );
}
