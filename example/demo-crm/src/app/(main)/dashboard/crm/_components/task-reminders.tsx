import * as React from "react";

import { CalendarCheck2, CalendarDays, CalendarRange } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { CrmMeeting } from "@/lib/crm-types";
import { cn } from "@/lib/utils";

const proposalGoalBarCount = 42;

export function TaskReminders({
  meetings,
  proposalSent,
  proposalGoal,
  onCompleteMeeting,
  onOpenOpportunity,
}: {
  meetings: CrmMeeting[];
  proposalSent: number;
  proposalGoal: number;
  onCompleteMeeting: (meetingId: string) => Promise<void>;
  onOpenOpportunity: (opportunityId: string) => void;
}) {
  const [calendarOpen, setCalendarOpen] = React.useState(false);
  const primaryMeeting = meetings[0];
  const proposalProgressPercentage = Math.round((proposalSent / proposalGoal) * 100);
  const activeProposalBars = Math.round((proposalSent / proposalGoal) * proposalGoalBarCount);
  const proposalGoalBars = Array.from({ length: proposalGoalBarCount }, (_, index) => ({
    id: `proposal-goal-${index + 1}`,
    active: index < activeProposalBars,
  }));

  return (
    <section className="grid grid-cols-1 gap-4 xl:grid-cols-12">
      <Card className="xl:col-span-8">
        <CardHeader>
          <CardTitle>Upcoming Meetings</CardTitle>
          <CardAction>
            <Button
              data-ai-id="crm.calendar.view_button"
              variant="outline"
              size="sm"
              onClick={() => setCalendarOpen(true)}
            >
              <CalendarDays data-icon="inline-start" />
              View Calendar
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            <div className="flex items-center justify-between text-muted-foreground text-xs tabular-nums">
              <div className="flex flex-col items-center gap-1">
                <span>08:45</span>
                <span className="h-2 w-px bg-border" />
              </div>
              <div className="flex flex-col items-center gap-1">
                <span>09:00</span>
                <span className="h-2 w-px bg-border" />
              </div>
              <div className="flex flex-col items-center gap-1">
                <span>10:00</span>
                <span className="h-2 w-px bg-border" />
              </div>
              <div className="flex flex-col items-center gap-1">
                <span>10:20</span>
                <span className="h-2 w-px bg-border" />
              </div>
            </div>

            <div className="relative h-14">
              <div className="absolute inset-x-3 top-1/2 h-px -translate-y-1/2 bg-border/80" />
              <div className="absolute top-2 bottom-2 left-[22%] flex w-[44%] items-center rounded-lg bg-primary px-2 text-primary-foreground shadow-sm">
                <div className="flex items-center gap-2">
                  <div className="flex size-7 items-center justify-center rounded-full bg-background text-primary">
                    <CalendarRange className="size-3.5" />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate font-medium text-primary-foreground text-xs leading-none">
                      {primaryMeeting?.title ?? "No meetings scheduled"}
                    </div>
                    <div className="truncate text-[10px] text-primary-foreground/75">
                      {primaryMeeting?.account ?? "Calendar clear"}
                    </div>
                  </div>
                </div>
              </div>
              <div className="absolute top-4 bottom-4 left-[64%] w-1 rounded-full bg-background/90" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="xl:col-span-4">
        <CardHeader>
          <CardTitle>Monthly Proposal Goal</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          <div className="flex items-end justify-between gap-3">
            <div className="font-medium text-2xl tabular-nums leading-none">
              {proposalSent} <span className="font-normal text-base text-muted-foreground">sent</span>
            </div>
            <div className="text-muted-foreground text-sm tabular-nums">{proposalGoal} target</div>
          </div>
          <div className="flex h-10 w-full items-end gap-0.5">
            {proposalGoalBars.map((bar) => (
              <div key={bar.id} className="flex flex-1 justify-center">
                <div
                  className={cn(
                    "h-10 w-1.5 rounded-full",
                    bar.active ? "bg-muted-foreground/75" : "bg-muted-foreground/25",
                  )}
                />
              </div>
            ))}
          </div>
          <p className="text-muted-foreground text-sm">
            {proposalProgressPercentage}% of this month&apos;s proposal target reached.
          </p>
        </CardContent>
      </Card>

      <Dialog open={calendarOpen} onOpenChange={setCalendarOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>CRM Calendar</DialogTitle>
            <DialogDescription>
              Review upcoming meetings and toggle completion for repeatable demo flows.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {meetings.map((meeting) => (
              <div
                key={meeting.id}
                className="flex flex-col gap-3 rounded-lg border p-3 md:flex-row md:items-center md:justify-between"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="font-medium">{meeting.title}</div>
                    <Badge variant="outline">{meeting.status}</Badge>
                  </div>
                  <div className="text-muted-foreground text-sm">
                    {meeting.account} · {meeting.date} · {meeting.time}
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {meeting.status === "completed"
                      ? "Reopen this meeting if you need to redo the follow-up."
                      : "Mark it complete after the call finishes."}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    data-ai-id={`crm.calendar.meeting.${meeting.id}.complete_button`}
                    variant="outline"
                    size="sm"
                    onClick={() => onCompleteMeeting(meeting.id)}
                  >
                    <CalendarCheck2 />
                    {meeting.status === "completed" ? "Reopen" : "Mark complete"}
                  </Button>
                  <Button
                    data-ai-id={`crm.calendar.meeting.${meeting.id}.open_opportunity_button`}
                    variant="outline"
                    size="sm"
                    disabled={!meeting.opportunityId}
                    onClick={() => meeting.opportunityId && onOpenOpportunity(meeting.opportunityId)}
                  >
                    Open opportunity
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
