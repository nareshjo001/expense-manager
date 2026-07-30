import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
} from 'recharts';
import { getColors } from '../linechart/MultiTrendChartWrapper';
import { useIsMobile } from '../../hooks/useIsMobile';

// Renders the category/month bar chart with an optional second (budget) bar series.
const BarChartWrapper = ({
  data,
  xKey,
  barKey,
  secondBarKey,
  showDoubleBar,
  theme
}) => {
  const colors = getColors(theme);
  const isDark = theme === 'dark-theme';
  const gradientId = isDark ? 'darkBlueGradient' : 'vibrantMetalPink';

  const isMobile = useIsMobile();

  const CustomLineTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div
          className="custom-tooltip"
          style={{
            background: isDark ? '#1f2937' : '#fff',
            color: isDark ? '#F9FAFB' : '#111',
            padding: '10px',
            borderRadius: '8px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
          }}
        >
          <p><strong>{label}</strong></p>
          {payload.map((entry, index) => (
            <p key={`item-${index}`} style={{ color: entry.stroke, margin: 0 }}>
              <strong>{entry.name}:</strong> ₹{entry.value}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  const chartHeight = isMobile ? 350 : 400;

  const legendItems = [
    {
      label: barKey === 'total' ? 'Spent' : barKey,
      color: `url(#${gradientId})`,
    },
  ];

  if (showDoubleBar && secondBarKey) {
    legendItems.push({
      label: 'Budget',
      color: `url(#${isDark ? 'deepPlumGradient' : 'vibrantSoftPurple'})`,
    });
  }

  return (
    <div className="chart-with-legend">
      <div className="custom-legend">
        {legendItems.map((item, index) => (
          <div key={index} className="legend-item">
            <svg width="12" height="12" viewBox="0 0 12 12">
              <circle
                cx="6"
                cy="6"
                r="5"
                fill={item.color}
              />
            </svg>
            <span className="legend-text">{item.label}</span>
          </div>
        ))}
      </div>
      <div style={{ width: '100%', height: chartHeight }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 30, right: 10, left: 0, bottom: 70 }}
          >
            <defs>
              <linearGradient id="vibrantMetalPink" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f472b6" />
                <stop offset="25%" stopColor="#fb5ca5" />
                <stop offset="50%" stopColor="#ff4fa3" />
                <stop offset="75%" stopColor="#e11d74" />
                <stop offset="100%" stopColor="#be185d" />
              </linearGradient>

              <linearGradient id="vibrantSoftPurple" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#a78bfa" />
                <stop offset="50%" stopColor="#c084fc" />
                <stop offset="100%" stopColor="#d8b4fe" />
              </linearGradient>

              <linearGradient id="darkBlueGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3B82F6" />
                <stop offset="50%" stopColor="#2563EB" />
                <stop offset="100%" stopColor="#1E40AF" />
              </linearGradient>

              <linearGradient id="deepPlumGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#9333EA" />
                <stop offset="40%" stopColor="#7e22ce" />
                <stop offset="80%" stopColor="#6b21a8" />
                <stop offset="100%" stopColor="#581c87" />
              </linearGradient>
            </defs>

            <CartesianGrid
              strokeDasharray="3 3"
              stroke={isDark ? "#374151" : "#f9a8d4"}
            />

            <XAxis
              dataKey={xKey}
              stroke={isDark ? "#F9FAFB" : "#9d174d"}
              tick={{
                angle: -45,
                dy: 35,
                dx: -7,
                fill: colors.axisColor
              }}
            />

            <YAxis
              stroke={colors.axisColor}
              width={50}
              tick={{
                fill: colors.axisColor,
                fontSize: isMobile ? 14 : 15,
                angle: -45,
                textAnchor: 'end',
              }}
              tickMargin={7}
              tickFormatter={(v) => `₹${v}`}
            />

            <Tooltip content={<CustomLineTooltip />} />

            <Bar
              dataKey={barKey}
              fill={`url(#${gradientId})`}
              radius={[8, 8, 0, 0]}
              animationDuration={1200}
              animationEasing="ease-out"
              name={barKey === 'total' ? 'Spent' : barKey}
            />

            {showDoubleBar && secondBarKey && (
              <Bar
                dataKey={secondBarKey}
                fill={`url(#${isDark ? 'deepPlumGradient' : 'vibrantSoftPurple'})`}
                radius={[8, 8, 0, 0]}
                animationDuration={1200}
                animationEasing="ease-out"
                name="Budget"
              />
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default BarChartWrapper;