"use client";

import { ArrowUpRight, TrendingDown, TrendingUp } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import type { CrmMetrics } from "@/lib/crm-types";

type KpiCardsProps = {
  metrics: CrmMetrics;
};

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function TrendBadge({
  current,
  previous,
  unit,
}: {
  current: number;
  previous: number;
  unit?: "%" | "";
}) {
  const delta = current - previous;
  const positive = delta >= 0;
  const formattedDelta = `${positive ? "+" : ""}${unit === "%" ? delta.toFixed(1) : Math.round(delta)}${unit}`;

  return (
    <Badge
      variant="outline"
      className={
        positive
          ? "border-green-200 bg-green-500/10 text-green-700 dark:border-green-900/40 dark:bg-green-500/15 dark:text-green-300"
          : "border-destructive/20 bg-destructive/10 text-destructive"
      }
    >
      {positive ? <TrendingUp /> : <TrendingDown />}
      {formattedDelta}
    </Badge>
  );
}

export function KpiCards({ metrics }: KpiCardsProps) {
  return (
    <section className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-3xl tracking-tight">Pipeline Overview</h2>
        <p className="text-muted-foreground text-sm">
          Keep tabs on lead quality, open opportunities, and conversion rates across the current sales cycle.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader>
            <CardDescription>Lead Pipeline Value</CardDescription>
            <CardAction>
              <ArrowUpRight className="size-4" />
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center gap-3">
              <span className="text-3xl leading-none tracking-tight">{formatCurrency(metrics.pipelineValue)}</span>
              <TrendBadge current={metrics.pipelineValue} previous={metrics.pipelineValuePrevious} />
            </div>
            <p className="text-sm">
              <span className="font-medium text-foreground">{formatCurrency(metrics.pipelineValuePrevious)}</span>{" "}
              <span className="text-muted-foreground">last month</span>
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>Qualified Lead Rate</CardDescription>
            <CardAction>
              <ArrowUpRight className="size-4" />
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center gap-3">
              <span className="text-3xl leading-none tracking-tight">{formatPercent(metrics.qualifiedRate)}</span>
              <TrendBadge current={metrics.qualifiedRate} previous={metrics.qualifiedRatePrevious} unit="%" />
            </div>
            <p className="text-sm">
              <span className="font-medium text-foreground">{formatPercent(metrics.qualifiedRatePrevious)}</span>{" "}
              <span className="text-muted-foreground">last month</span>
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>Open Opportunities</CardDescription>
            <CardAction>
              <ArrowUpRight className="size-4" />
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center gap-3">
              <span className="text-3xl leading-none tracking-tight">{metrics.openOpportunities}</span>
              <TrendBadge current={metrics.openOpportunities} previous={metrics.openOpportunitiesPrevious} />
            </div>
            <p className="text-sm">
              <span className="font-medium text-foreground">{metrics.openOpportunitiesPrevious}</span>{" "}
              <span className="text-muted-foreground">last month</span>
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>Lead-to-Deal Rate</CardDescription>
            <CardAction>
              <ArrowUpRight className="size-4" />
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center gap-3">
              <span className="text-3xl leading-none tracking-tight">{formatPercent(metrics.leadToDealRate)}</span>
              <TrendBadge current={metrics.leadToDealRate} previous={metrics.leadToDealRatePrevious} unit="%" />
            </div>
            <p className="text-sm">
              <span className="font-medium text-foreground">{formatPercent(metrics.leadToDealRatePrevious)}</span>{" "}
              <span className="text-muted-foreground">last month</span>
            </p>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
