/** Insights: stat cards, charts, text answers, AI summary, CSV export.
 *
 * Chart conventions (kept consistent across every chart):
 * - one hue per chart (violet bars, fuchsia trend line) — matches Parlo's palette
 * - recessive grid/axes in border/dim tokens, values in text tokens
 * - thin marks with rounded data-ends, tooltips on hover
 */

import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import StatCard from "../components/StatCard";
import { downloadCsv, getInsights, summarize } from "../lib/api";
import type { DistributionInsight, Insights, QuestionInsight, Summary } from "../lib/types";

// Validated on the #0e1116 surface with the palette checker.
const BAR_COLOR = "#7c3aed"; // iris (violet) — categorical/magnitude bars
const LINE_COLOR = "#e879f9"; // glow (fuchsia) — the time-series line
const GRID_COLOR = "#28303c";
const AXIS_COLOR = "#98a2b3";

const axisStyle = { fill: AXIS_COLOR, fontSize: 12 };
const tooltipStyle = {
  backgroundColor: "#1a202a",
  border: "1px solid #28303c",
  borderRadius: 12,
  color: "#e8ecf1",
  fontSize: 12,
};

export default function InsightsPage() {
  const { id = "" } = useParams();
  const [data, setData] = useState<Insights | null>(null);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summarizing, setSummarizing] = useState(false);

  useEffect(() => {
    getInsights(id).then(setData).catch(() => setError("Couldn't load insights"));
  }, [id]);

  if (error) return <p className="text-red-400">{error}</p>;
  if (!data) return <p className="text-dim">Loading…</p>;

  // Overall average rating across all rating questions (weighted by answers).
  const ratingQuestions = data.questions.filter(
    (q) => q.type === "rating" && q.average !== null && q.answer_count > 0,
  );
  const totalRatings = ratingQuestions.reduce((sum, q) => sum + q.answer_count, 0);
  const overallRating =
    totalRatings > 0
      ? ratingQuestions.reduce((sum, q) => sum + (q.average ?? 0) * q.answer_count, 0) /
        totalRatings
      : null;

  async function handleSummarize() {
    setSummarizing(true);
    try {
      setSummary(await summarize(id));
    } catch {
      setSummary({ bullets: ["Couldn't generate a summary — try again."], sentiment: "" });
    } finally {
      setSummarizing(false);
    }
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/" className="text-sm text-dim hover:text-fog">
            ← All collections
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">{data.title}</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="btn-ghost text-xs"
            onClick={() => downloadCsv(id, `parlo-${data.form_id}.csv`)}
          >
            Export CSV
          </button>
          <Link className="btn-ghost text-xs" to={`/forms/${id}/edit`}>
            Edit questions
          </Link>
        </div>
      </div>

      {/* Headline numbers */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatCard label="Respondents" value={String(data.sessions_started)} />
        <StatCard
          label="Completion rate"
          value={`${Math.round(data.completion_rate * 100)}%`}
          hint={`${data.sessions_completed} finished`}
        />
        <StatCard
          label="Average rating"
          value={overallRating !== null ? overallRating.toFixed(1) : "—"}
          hint={overallRating !== null ? "out of 5" : "no rating questions yet"}
        />
      </div>

      {/* Responses over time */}
      <div className="card mb-6 p-5">
        <h2 className="mb-4 text-sm font-medium text-dim">
          Answers · last 14 days
        </h2>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={data.answers_by_day} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
            <CartesianGrid stroke={GRID_COLOR} vertical={false} />
            <XAxis
              dataKey="date"
              tick={axisStyle}
              tickFormatter={shortDate}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis tick={axisStyle} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip contentStyle={tooltipStyle} labelFormatter={shortDate} />
            <Line
              type="monotone"
              dataKey="count"
              name="Answers"
              stroke={LINE_COLOR}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* AI insights */}
      <div className="card mb-6 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-dim">AI insights</h2>
          <button className="btn-primary text-xs" onClick={handleSummarize} disabled={summarizing}>
            {summarizing ? "Reading the answers…" : summary ? "Refresh" : "Generate insights"}
          </button>
        </div>
        {summary && (
          <div className="mt-4">
            {summary.sentiment && (
              <span className="tag mb-3 capitalize text-iris border-iris/40">
                Overall sentiment: {summary.sentiment}
              </span>
            )}
            <ul className="mt-2 space-y-2">
              {summary.bullets.map((bullet, i) => (
                <li key={i} className="flex gap-2 text-sm">
                  <span className="text-iris">•</span>
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Per-question breakdowns */}
      <div className="space-y-4">
        {data.questions.map((question, index) => (
          <QuestionPanel key={question.question_id} question={question} index={index} />
        ))}
      </div>
    </div>
  );
}

function QuestionPanel({ question, index }: { question: QuestionInsight; index: number }) {
  return (
    <div className="card p-5">
      <h3 className="mb-1 text-sm font-medium">
        <span className="text-dim">{index + 1}. </span>
        {question.text}
      </h3>
      <p className="mb-4 text-xs text-dim">
        {question.answer_count} answer{question.answer_count === 1 ? "" : "s"}
        {question.average !== null && ` · average ${question.average}`}
      </p>

      {question.type === "single_choice" || question.type === "multi_choice" ? (
        <ChoiceBars counts={question.counts} />
      ) : question.type === "rating" || question.type === "number" ? (
        <DistributionBars counts={question.counts} />
      ) : question.type === "distribution" ? (
        <AllocationBars distribution={question.distribution} />
      ) : question.values.length > 0 ? (
        <ul className="nice-scroll max-h-64 space-y-2 overflow-y-auto pr-2">
          {question.values.map((value, i) => (
            <li key={i} className="rounded-xl bg-surface px-3 py-2 text-sm">
              {value}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-dim">No answers yet.</p>
      )}
    </div>
  );
}

/** Horizontal bars — one per option, so long labels stay readable. */
function ChoiceBars({ counts }: { counts: Record<string, number> }) {
  const rows = Object.entries(counts).map(([option, count]) => ({ option, count }));
  if (rows.length === 0) return <p className="text-sm text-dim">No options configured.</p>;
  return (
    <ResponsiveContainer width="100%" height={Math.max(120, rows.length * 44)}>
      <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 32, left: 8, bottom: 0 }}>
        <CartesianGrid stroke={GRID_COLOR} horizontal={false} />
        <XAxis type="number" tick={axisStyle} axisLine={false} tickLine={false} allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="option"
          tick={axisStyle}
          width={140}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
        <Bar dataKey="count" name="Answers" fill={BAR_COLOR} radius={[0, 4, 4, 0]} barSize={18}>
          <LabelList dataKey="count" position="right" style={{ fill: AXIS_COLOR, fontSize: 12 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Vertical distribution bars — ratings (1–5) and numbers. */
function DistributionBars({ counts }: { counts: Record<string, number> }) {
  const rows = Object.entries(counts)
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => Number(a.value) - Number(b.value));
  if (rows.length === 0) return <p className="text-sm text-dim">No answers yet.</p>;
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={rows} margin={{ top: 16, right: 8, left: -24, bottom: 0 }}>
        <CartesianGrid stroke={GRID_COLOR} vertical={false} />
        <XAxis dataKey="value" tick={axisStyle} axisLine={false} tickLine={false} />
        <YAxis tick={axisStyle} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
        <Bar dataKey="count" name="Answers" fill={BAR_COLOR} radius={[4, 4, 0, 0]} barSize={28}>
          <LabelList dataKey="count" position="top" style={{ fill: AXIS_COLOR, fontSize: 12 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Horizontal bars — average points allocated to each option (sums to ~100). */
function AllocationBars({ distribution }: { distribution: DistributionInsight[] }) {
  const rows = distribution.map(({ option, avg }) => ({ option, avg }));
  if (rows.every((row) => row.avg === 0)) {
    return <p className="text-sm text-dim">No allocations yet.</p>;
  }
  return (
    <ResponsiveContainer width="100%" height={Math.max(120, rows.length * 44)}>
      <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 40, left: 8, bottom: 0 }}>
        <CartesianGrid stroke={GRID_COLOR} horizontal={false} />
        <XAxis
          type="number"
          domain={[0, 100]}
          tick={axisStyle}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="option"
          tick={axisStyle}
          width={140}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
        <Bar dataKey="avg" name="Avg points" fill={BAR_COLOR} radius={[0, 4, 4, 0]} barSize={18}>
          <LabelList dataKey="avg" position="right" style={{ fill: AXIS_COLOR, fontSize: 12 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** "2026-07-03" → "Jul 3" for axis ticks and tooltips. */
function shortDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
