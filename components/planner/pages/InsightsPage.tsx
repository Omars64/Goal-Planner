"use client";

import { useMemo, useState } from "react";
import { Activity, Award, BarChart3, CheckCircle2, Lightbulb, Target, TrendingUp } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { api } from "../api";
import { addDays, toISODate } from "../date";
import { ErrorState, LoadingState, PageHeader, Panel, ProgressRing, useResource } from "../shared";


export function InsightsPage() {
  const [range, setRange] = useState("7");
  const end = toISODate(new Date());
  const start = toISODate(addDays(new Date(), -(Number(range) - 1)));
  const resource = useResource(() => api.insights(start, end), [start, end]);

  const observations = useMemo(() => {
    if (!resource.data) return [];
    const strongest = [...resource.data.daily].sort((a, b) => (b.tasks_completed + b.habits_completed) - (a.tasks_completed + a.habits_completed))[0];
    const totalTasks = resource.data.daily.reduce((sum, day) => sum + day.tasks_completed, 0);
    const totalHabits = resource.data.daily.reduce((sum, day) => sum + day.habits_completed, 0);
    const result = [
      strongest ? `${strongest.label} is your strongest recorded day in this range.` : "Complete a task or habit to begin building a pattern.",
      totalTasks ? `${totalTasks} tasks were completed across the selected period.` : "No completed tasks are recorded yet; keep today’s list intentionally small.",
      totalHabits ? `${totalHabits} habit check-ins were recorded. Consistency matters more than a perfect score.` : "Your habit grid is ready for the first check-in.",
    ];
    return result;
  }, [resource.data]);

  return (
    <div className="page-shell insights-page">
      <PageHeader eyebrow="Patterns, not pressure" title="Insights" description="Review completion patterns across tasks, habits, and goals to make next week more realistic." actions={<Select value={range} onValueChange={setRange}><SelectTrigger className="range-select"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="7">Last 7 days</SelectItem><SelectItem value="14">Last 14 days</SelectItem><SelectItem value="30">Last 30 days</SelectItem></SelectContent></Select>} />

      {resource.loading && !resource.data ? <LoadingState label="Calculating your trends…" /> : null}
      {resource.error && !resource.data ? <ErrorState message={resource.error} onRetry={() => void resource.reload()} /> : null}
      {resource.data ? (
        <>
          <div className="insight-metric-grid">
            <article><CheckCircle2 /><div><span>Task completion</span><strong>{resource.data.task_completion_rate}%</strong></div></article>
            <article><Activity /><div><span>Habit consistency</span><strong>{resource.data.habit_completion_rate}%</strong></div></article>
            <article><Target /><div><span>Active goals</span><strong>{resource.data.active_goals}</strong></div></article>
            <article><Award /><div><span>Completed goals</span><strong>{resource.data.completed_goals}</strong></div></article>
          </div>

          <div className="insights-layout">
            <Panel className="insight-chart" title="Daily completion rhythm">
              <div className="chart-wrap" aria-label="Bar chart of completed tasks and habits by day">
                <ResponsiveContainer width="100%" height={340}>
                  <BarChart data={resource.data.daily} margin={{ top: 18, right: 12, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 6" stroke="rgba(255,255,255,.09)" vertical={false} />
                    <XAxis dataKey="label" stroke="#9aa0bd" tickLine={false} axisLine={false} fontSize={12} />
                    <YAxis allowDecimals={false} stroke="#9aa0bd" tickLine={false} axisLine={false} fontSize={12} />
                    <Tooltip cursor={{ fill: "rgba(255,255,255,.04)" }} contentStyle={{ background: "#171629", border: "1px solid rgba(255,255,255,.14)", borderRadius: 12 }} />
                    <Legend iconType="circle" />
                    <Bar dataKey="tasks_completed" name="Tasks" fill="#ec4899" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="habits_completed" name="Habits" fill="#22c55e" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>

            <Panel className="insight-rings" title="Completion balance">
              <div className="ring-pair"><ProgressRing value={resource.data.task_completion_rate} label="tasks" size={132} /><ProgressRing value={resource.data.habit_completion_rate} label="habits" size={132} /></div>
              <div className="balance-note"><TrendingUp /><p>Use these percentages as feedback, not judgment. If both fall for several days, reduce the number of planned items before increasing effort.</p></div>
            </Panel>

            <Panel className="insight-observations" title="What the data says">
              <div className="observation-list">
                {observations.map((observation, index) => <article key={observation}><span>{index + 1}</span><p>{observation}</p></article>)}
              </div>
            </Panel>

            <Panel className="insight-guide" title="Weekly review prompt">
              <div className="review-prompt"><Lightbulb /><div><p className="eyebrow">Two-minute reflection</p><h2>What made the easiest successful day easier?</h2><p>Reuse that condition next week—time, place, task size, or preparation—before adding more goals.</p></div></div>
              <div className="insight-range"><BarChart3 /><span>Showing {resource.data.start} through {resource.data.end}</span></div>
            </Panel>
          </div>
        </>
      ) : null}
    </div>
  );
}

