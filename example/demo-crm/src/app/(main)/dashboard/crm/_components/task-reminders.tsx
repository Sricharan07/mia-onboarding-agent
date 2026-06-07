"use client";

import * as React from "react";
import { CalendarCheck2, CalendarDays, CalendarRange } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { CrmMeeting } from "@/lib/crm-types";

type TaskRemindersProps = {
  proposalSent: number;
  proposalGoal: number;
  meetings: CrmMeeting[];
  onCompleteMeeting: (meetingId: string) => Promise<void>;
};

const proposalGoalBarCount = 42;

export function TaskReminders({ meetings, proposalGoal, proposalSent, onCompleteMeeting }: TaskRemindersProps) {
  const [calendarOpen, setCalendarOpen] = React.useState(false);
  const proposalProgressPercentage = proposalGoal > 0 ? Math.round((proposalSent / proposalGoal) * 100) : 0;
  const proposalRatio = proposalGoal > 0 ? proposalSent / proposalGoal : 0;
  const activeProposalBars = Math.round(proposalRatio * proposalGoalBarCount);
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
            <Button variant="outline" size="sm" onClick={() => setCalendarOpen(true)} data-ai-id="crm.view-calendar">
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
                      {meetings[0]?.title ?? "Product demo with Tim"}
                    </div>
                    <div className="truncate text-[10px] text-primary-foreground/75">
                      {meetings[0]?.account ?? "Weblabs Studio"}
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
          <p className="text-muted-foreground text-sm">{proposalProgressPercentage}% of this month&apos;s proposal target reached.</p>
        </CardContent>
      </Card>

      <Dialog open={calendarOpen} onOpenChange={setCalendarOpen}>
        <DialogContent className="sm:max-w-[40rem]">
          <DialogHeader>
            <DialogTitle>Calendar</DialogTitle>
            <DialogDescription>These meetings are backed by the CRM store and can be completed from here.</DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-[22rem] pr-2">
            <div className="space-y-3">
              {meetings.map((meeting) => (
                <div key={meeting.id} className="rounded-lg border border-border/60 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium">{meeting.title}</div>
                      <div className="text-sm text-muted-foreground">
                        {meeting.account} • {meeting.date} • {meeting.time}
                      </div>
                    </div>
                    <Badge variant={meeting.status === "completed" ? "secondary" : "outline"} className="rounded-full px-2.5">
                      {meeting.status}
                    </Badge>
                  </div>
                  <Separator className="my-3" />
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm text-muted-foreground">
                      {meeting.status === "completed"
                        ? "Reopen this meeting if you need to redo the follow-up."
                        : "Mark it complete after the call finishes."}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onCompleteMeeting(meeting.id)}
                    >
                      <CalendarCheck2 />
                      {meeting.status === "completed" ? "Reopen" : "Mark complete"}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>

          <DialogFooter>
            <Button onClick={() => setCalendarOpen(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
