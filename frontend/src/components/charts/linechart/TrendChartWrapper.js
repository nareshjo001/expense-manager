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

// Single-series area/trend chart with an average-relative custom dot indicator.
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
  const colors = theme === 'dark-theme' ? darkThemeColors : lightThemeColors;

  const isMobile = useIsMobile();

  return (
    <ResponsiveContainer width="100%" height={isMobile ? 280 : 400}>
      <AreaChart data={data} margin={{ top: 30, right: 10, left: 0, bottom: 30 }}>
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

        <Tooltip content={tooltipComponent} />

        <CartesianGrid stroke={colors.gridColor} strokeDasharray="3 3" />

        <Area
          type="monotone"
          dataKey={yKey}
          stroke={colors.lineColors[0]}
          strokeWidth={2.5}
          dot={(props) => (
            <CustomizedDot {...props} average={average} yKey={yKey} />
          )}
          activeDot={{ r: 0.5 }}
          fill="url(#gradientFill)"
          animationDuration={animationDuration}
          animationEasing={animationEasing}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
};

export default TrendChartWrapper;