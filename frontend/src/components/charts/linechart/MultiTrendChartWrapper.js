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

// Color theme for light mode
export const lightThemeColorsTrend = {
  gridColor: 'rgba(157, 23, 77, 0.15)', // Pinkish grid color
  axisColor: '#9d174d', // Dark pink axis
  lineColors: [
    '#d946ef', // Fuchsia
    '#f97316', // Orange
    '#14b8a6', // Teal
    '#3b82f6', // Blue
    '#be185d', // Dark Pink
  ],
};

// Color theme for dark mode
export const darkThemeColorsTrend = {
  gridColor: 'rgba(255, 255, 255, 0.1)', // Light grid on dark bg
  axisColor: '#cbd5e1', // Soft white axis
  lineColors: [
    '#fb923c', // Orange
    '#a3e635', // Lime
    '#c084fc', // Purple
    '#facc15', // Yellow
    '#67e8f9', // Cyan
  ],
};

// Function to pick the right color palette based on theme
export const getColors = (theme) => {
  return theme === 'dark-theme' ? darkThemeColorsTrend : lightThemeColorsTrend;
};

const MultiLineChartWrapper = ({
  theme,
  data,
  xKey = 'month',         // Default X-axis key
  linesData = [],         // Array of { dataKey, name }
  animationDuration = 3000,
  animationEasing = 'linear',
}) => {
  const colors = getColors(theme);

  // Custom Tooltip for line chart
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
          {/* Grid lines */}
          <CartesianGrid stroke={colors.gridColor} strokeDasharray="3 3" />

          {/* X-Axis configuration */}
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

          {/* Y-Axis configuration with label */}
          <YAxis
              stroke={colors.axisColor}
              width={50}                 // still required
              tick={{
                fill: colors.axisColor,
                fontSize: isMobile ? 14 : 15,
                angle: -45,             // rotate ticks
                textAnchor: 'end',       // IMPORTANT
              }}
              tickMargin={7}
              tickFormatter={(v) => `₹${v}`}
          />

          {/* Custom tooltip component */}
          <Tooltip content={<CustomLineTooltip />} />

          {/* Dynamic rendering of multiple lines */}
          {linesData.map((line, index) => (
            <Line
              key={line.dataKey}
              type="monotone"
              dataKey={line.dataKey}
              name={line.name}
              stroke={colors.lineColors[index % colors.lineColors.length]} // Rotate colors
              strokeWidth={2}
              dot={{ r: 3 }}       // Normal dots
              activeDot={{ r: 6 }} // Enlarged dot on hover
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