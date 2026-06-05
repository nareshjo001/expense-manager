import React, { useState, useContext } from 'react';
import { PieChart, Pie, Sector, ResponsiveContainer, Cell } from 'recharts';
import { ThemeContext, LightThemeGradients, DarkThemeGradients } from '../../imports/chartsImport';

import { useIsMobile } from '../../hooks/useIsMobile';

const renderActiveShape = (theme, isCount, isMobile) => (props) => {
  const {
    cx, cy, midAngle, innerRadius, outerRadius, startAngle, endAngle,
    fill, payload, percent, value
  } = props;

  const RADIAN = Math.PI / 180;
  const sin = Math.sin(-RADIAN * midAngle);
  const cos = Math.cos(-RADIAN * midAngle);
  
  const light = ['#ad1457', '#000']; 
  const dark = ['#F3E8FF', '#60A5FA'];
  const hoverColors = theme === 'dark-theme' ? dark : light;
  
  if (isMobile) {
    return (
      <g>
        {/* Outer Line */}
        <Sector
          cx={cx}
          cy={cy}
          startAngle={startAngle}
          endAngle={endAngle}
          innerRadius={outerRadius + 4}
          outerRadius={outerRadius + 8}
          fill={fill}
        />

        {/* active slice */}
        <Sector
          cx={cx}
          cy={cy}
          innerRadius={innerRadius}
          outerRadius={outerRadius}
          startAngle={startAngle}
          endAngle={endAngle}
          fill={fill}
        />

        {/* category */}
        <text
          x={cx}
          y={cy - 14}
          textAnchor="middle"
          fontSize={20}
          fontWeight={600}
          fill={fill}
        >
          {payload.category}
        </text>

        {/* value */}
        <text
          x={cx}
          y={cy + 7}
          textAnchor="middle"
          fontSize={16}
          fill={hoverColors[0]}
        >
          {isCount ? value : `₹${value}`}
        </text>

        {/* percentage */}
        <text
          x={cx}
          y={cy + 26}
          textAnchor="middle"
          fontSize={15}
          opacity={0.8}
          fill={hoverColors[1]}
        >
          {(percent * 100).toFixed(1)}%
        </text>
      </g>
    );
  }

  const sx = cx + (outerRadius + 14) * cos;
  const sy = cy + (outerRadius + 10) * sin;
  const mx = cx + (outerRadius + 42) * cos;
  const my = cy + (outerRadius + 30) * sin;
  const ex = mx + (cos >= 0 ? 1 : -1) * 28;
  const ey = my;
  const textAnchor = cos >= 0 ? 'start' : 'end';

  return (
    <g>
      <text 
        x={cx} 
        y={cy} 
        dy={8} 
        textAnchor="middle" 
        fill={fill}  
        fontSize={20}
        fontWeight={700}
      >
        {payload.category}
      </text>
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={innerRadius}
        outerRadius={outerRadius}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
      />
      <Sector
        cx={cx}
        cy={cy}
        startAngle={startAngle}
        endAngle={endAngle}
        innerRadius={outerRadius + 6}
        outerRadius={outerRadius + 10}
        fill={fill}
      />
      <path d={`M${sx},${sy}L${mx},${my}L${ex},${ey}`} stroke={fill} fill="none" />
      <circle cx={ex} cy={ey} r={2} fill={fill} stroke="none" />
      <text 
        x={ex + (cos >= 0 ? 1 : -1) * 12} 
        y={ey} 
        textAnchor={textAnchor} 
        fill= {hoverColors[0]}
        fontSize={18}
        fontStyle="italic"
        fontWeight={500}
      >
        {isCount ? value : `₹${value}`}
      </text>
      <text 
        x={ex + (cos >= 0 ? 1 : -1) * 12} 
        y={ey} 
        dy={22} 
        textAnchor={textAnchor} 
        fill= {hoverColors[1]}
        fontSize={18}
        fontStyle="italic"
      >
        {(percent * 100).toFixed(1)}%
      </text>
    </g>
  );
};

const lightGradientIds = [
  'lt-pink-highlight',
  'lt-magenta-highlight',
  'lt-orange-highlight',
  'lt-purple-highlight',
  'lt-yellow-highlight',
  'lt-light-blue-highlight',
  'lt-cyan-highlight',
  'lt-green-highlight',
  'lt-gray-highlight',
  'lt-red-highlight',
];

const darkGradientIds = [
  'dk-blue-glow', 
  'dk-orange-glow', 
  'dk-green-glow', 
  'dk-yellow-glow', 
  'dk-purple-glow', 
  'dk-pink-glow', 
  'dk-red-glow', 
  'dk-cyan-glow', 
  'dk-magenta-glow', 
  'dk-gray-glow'
];

const PieChartWrapper = ({ data, show }) => {
 
  const { theme } = useContext(ThemeContext);

  const isMobile = useIsMobile();

  const [activeIndex, setActiveIndex] = useState(0);
  const handlePieEnter = (_, index) => setActiveIndex(index);

  const gradientIds = theme === 'dark-theme' ? darkGradientIds : lightGradientIds;

  let isCount;
  if(show === 'count') {
    isCount = true;
  }

  return (
      <div style={{ width: '100%', height: 420, position: 'relative' }}>
        <p
          style={{
            position: 'absolute',
            top: 12,
            left: '50%',
            transform: 'translateX(-50%)',
            margin: 0,
            textAlign: 'center',
            fontSize: '16px',
            opacity: 0.85,
            fontWeight: '500',
            pointerEvents: 'none',
          }}
        >
          {show !== '' ? (isMobile ? 'Tap to view details' : 'Hover to view details') : ""}
        </p>
        <ResponsiveContainer>
         <PieChart
            margin={{
              top: 35,
              right: isMobile ? 20 : 40,
              bottom: isMobile ? 5 : 20,
              left: isMobile ? 20 : 40,
            }}
          >
            {theme === 'dark-theme' ? <DarkThemeGradients /> : <LightThemeGradients />}

            <Pie
              activeIndex={activeIndex}
              activeShape={renderActiveShape(theme, isCount, isMobile)}
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={isMobile ? 100 : 90}
              outerRadius={isMobile ? 150 : 140}
              dataKey="total"
              nameKey="category"
              onMouseEnter={handlePieEnter}
            >
              {data.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={`url(#${gradientIds[index % gradientIds.length]})`}
                />
              ))}
            </Pie>
            
          </PieChart>
        </ResponsiveContainer>
      </div>
  );
};

export default PieChartWrapper;