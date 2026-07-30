import React from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

import { useIsMobile } from '../../hooks/useIsMobile';

export const lightThemeColorsTrend = {
  gridColor: 'rgba(157, 23, 77, 0.15)',
  axisColor: '#9d174d',
  lineColors: [
    '#d946ef',
    '#f97316',
    '#14b8a6',
    '#3b82f6',
    '#be185d',
  ],
};

export const darkThemeColorsTrend = {
  gridColor: 'rgba(255, 255, 255, 0.1)',
  axisColor: '#cbd5e1',
  lineColors: [
    '#fb923c',
    '#a3e635',
    '#c084fc',
    '#facc15',
    '#67e8f9',
  ],
};

export const getColors = (theme) => {
  return theme === 'dark-theme' ? darkThemeColorsTrend : lightThemeColorsTrend;
};

// Multi-series line chart for comparing expense trends across selected years.
const MultiLineChartWrapper = ({
  theme,
  data,
  xKey = 'month',
  linesData = [], // { dataKey, name } per line
  animationDuration = 3000,
  animationEasing = 'linear',
}) => {
  const colors = getColors(theme);

  const CustomLineTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div
          className="custom-tooltip"
          style={{
            background: theme === 'dark-theme' ? '#1f2937' : '#fff',
            color: theme === 'dark-theme' ? '#F9FAFB' : '#111',
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

  const isMobile = useIsMobile();

  return (
    <div className="chart-with-legend">
      <div className="custom-legend">
        {linesData.map((line, index) => (
          <div key={line.dataKey} className="legend-item">
            <span
              className="legend-dot"
              style={{ background: colors.lineColors[index] }}
            />
            <span>{line.name}</span>
          </div>
        ))}
      </div>
      
      <ResponsiveContainer width="100%" height={isMobile ? 280 : 400}>
        <LineChart data={data} margin={{ top: 30, right: 10, left: 0, bottom: 30 }}>
          <CartesianGrid stroke={colors.gridColor} strokeDasharray="3 3" />

          <XAxis
            dataKey={xKey}
            stroke={colors.axisColor}
            tick={{
              fill: colors.axisColor,
              fontSize: isMobile ? 14 : 16,
            }}
            tickMargin={9}
            interval="preserveStartEnd"
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

          {linesData.map((line, index) => (
            <Line
              key={line.dataKey}
              type="monotone"
              dataKey={line.dataKey}
              name={line.name}
              stroke={colors.lineColors[index % colors.lineColors.length]}
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 6 }}
              animationDuration={animationDuration}
              animationEasing={animationEasing}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default MultiLineChartWrapper;