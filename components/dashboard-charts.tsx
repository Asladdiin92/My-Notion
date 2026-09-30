"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Distribution = { name: string; value: number };
type TimelinePoint = { month: string; count: number };

const palette = ["#7c8d70", "#c5a16a", "#9986ad", "#86a0a2", "#cc856b", "#8696b1", "#b6a76f"];
const tooltipStyle = {
  border: "1px solid #e9eae5",
  borderRadius: "8px",
  fontSize: "11px",
  boxShadow: "0 6px 20px #2b30251a",
};

export function StatusChart({ data }: { data: Distribution[] }) {
  return (
    <div className="chart-area status-chart">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius="64%" outerRadius="88%" paddingAngle={3} stroke="none">
            {data.map((entry, index) => (
              <Cell key={entry.name} fill={entry.name === "Completed" ? "#788b6f" : palette[index % palette.length]} />
            ))}
          </Pie>
          <Tooltip contentStyle={tooltipStyle} formatter={(value) => [value, "Tasks"]} />
        </PieChart>
      </ResponsiveContainer>
      <div className="chart-center"><strong>{data.reduce((sum, item) => sum + item.value, 0)}</strong><span>tasks</span></div>
    </div>
  );
}

export function PriorityChart({ data }: { data: Distribution[] }) {
  return (
    <div className="chart-area priority-chart">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 5, bottom: 0, left: -20 }}>
          <CartesianGrid vertical={false} stroke="#efefec" />
          <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: "#91938c", fontSize: 9 }} />
          <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: "#a1a29c", fontSize: 9 }} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#f6f7f3" }} />
          <Bar dataKey="value" name="Tasks" fill="#819176" radius={[4, 4, 0, 0]} maxBarSize={35} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function TypeChart({ data }: { data: Distribution[] }) {
  return (
    <div className="type-chart-layout">
      <div className="chart-area type-chart">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius="65%" outerRadius="91%" paddingAngle={3} stroke="none">
              {data.map((entry, index) => <Cell key={entry.name} fill={palette[index % palette.length]} />)}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} formatter={(value) => [value, "Tasks"]} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="chart-legend">
        {data.slice(0, 5).map((item, index) => (
          <div className="legend-row" key={item.name}>
            <span className="legend-swatch" style={{ backgroundColor: palette[index % palette.length] }} />
            <span className="legend-name">{item.name}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
        {data.length === 0 && <span className="muted-copy">No task types yet</span>}
      </div>
    </div>
  );
}

export function TimelineChart({ data }: { data: TimelinePoint[] }) {
  return (
    <div className="chart-area timeline-chart">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 9, right: 10, bottom: 0, left: -18 }}>
          <CartesianGrid vertical={false} stroke="#efefec" />
          <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "#91938c", fontSize: 9 }} />
          <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: "#a1a29c", fontSize: 9 }} />
          <Tooltip contentStyle={tooltipStyle} />
          <Line type="monotone" dataKey="count" name="Tasks added" stroke="#77896c" strokeWidth={2.5} dot={{ fill: "#fff", stroke: "#77896c", strokeWidth: 2, r: 3 }} activeDot={{ r: 5 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
