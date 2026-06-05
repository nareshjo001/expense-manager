import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { CustomizedDot } from '../essentials/chartEssentials';
import { lightThemeColors, darkThemeColors } from '../essentials/chartEssentials';

import { useIsMobile } from '../../hooks/useIsMobile';

const TrendChartWrapper = ({
  theme,
  data,
  average,
  xKey = 'date',
  yKey = 'amount',
  tooltipComponent,
  animationDuration = 3000,
  animationEasing = 'ease-in-out',
}) => {
  // Pick theme-based colors for axis, fill, etc.
  const colors = theme === 'dark-theme' ? darkThemeColors : lightThemeColors;

  const isMobile = useIsMobile();

  return (
    <ResponsiveContainer width="100%" height={isMobile ? 280 : 400}>
      <AreaChart data={data} margin={{ top: 30, right: 10, left: 0, bottom: 30 }}>
        {/* Gradient definition for area fill */}
        <defs>
          <linearGradient id="gradientFill" x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0%"
              stopColor={colors.areaGradient.start}
              stopOpacity={colors.areaGradient.startOpacity}
            />
            <stop
              offset="100%"
              stopColor={colors.areaGradient.end}
              stopOpacity={colors.areaGradient.endOpacity}
            />
          </linearGradient>
        </defs>

        {/* X-Axis with rotated ticks for better readability */}
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

        {/* Y-Axis with vertical label */}
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

        {/* Custom tooltip to show detailed info on hover */}
        <Tooltip content={tooltipComponent} />

        {/* Light dashed grid behind the chart */}
        <CartesianGrid stroke={colors.gridColor} strokeDasharray="3 3" />

        {/* Main area plot with custom animated fill and dots */}
        <Area
          type="monotone"
          dataKey={yKey}
          stroke={colors.lineColors[0]}        // Line color
          strokeWidth={2.5}                    // Line thickness
          dot={(props) => (
            <CustomizedDot {...props} average={average} yKey={yKey} />
          )}                                   // Show average dot or custom dot
          activeDot={{ r: 0.5 }}               // Dot on hover
          fill="url(#gradientFill)"            // Gradient fill under line
          animationDuration={animationDuration} 
          animationEasing={animationEasing}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
};

export default TrendChartWrapper;