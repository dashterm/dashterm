import React, { useState } from 'react';
import { View, Text, StyleSheet, Platform, LayoutChangeEvent } from 'react-native';
import Svg, { Path, Line, Text as SvgText, Defs, LinearGradient, Stop } from 'react-native-svg';

interface TerminalChartProps {
  data: number[];
  height?: number;
  primaryColor?: string;
  showGrid?: boolean;
  showLabels?: boolean;
  label?: string;
}

export default function TerminalChart({
  data,
  height = 150,
  primaryColor = '#00FF00',
  showGrid = true,
  showLabels = true,
  label,
}: TerminalChartProps) {
  const [containerWidth, setContainerWidth] = useState(0);

  const handleLayout = (event: LayoutChangeEvent) => {
    const { width } = event.nativeEvent.layout;
    setContainerWidth(width);
  };

  if (!data || data.length < 2) {
    return (
      <View style={[styles.container, { height }]} onLayout={handleLayout}>
        <Text style={[styles.noData, { color: primaryColor }]}>NO DATA</Text>
      </View>
    );
  }

  // Wait for layout measurement
  if (containerWidth === 0) {
    return (
      <View style={[styles.container, { height }]} onLayout={handleLayout}>
        <Text style={[styles.noData, { color: primaryColor }]}>...</Text>
      </View>
    );
  }

  const width = containerWidth;
  const padding = { top: 20, right: 10, bottom: showLabels ? 25 : 10, left: showLabels ? 50 : 10 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const minValue = Math.min(...data);
  const maxValue = Math.max(...data);
  const range = maxValue - minValue || 1;

  // Calculate points for the line
  const points = data.map((value, index) => {
    const x = padding.left + (index / (data.length - 1)) * chartWidth;
    const y = padding.top + chartHeight - ((value - minValue) / range) * chartHeight;
    return { x, y, value };
  });

  // Create SVG path
  const linePath = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ');

  // Create area path (for gradient fill)
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${padding.top + chartHeight} L ${padding.left} ${padding.top + chartHeight} Z`;

  // Grid lines
  const gridLines = [];
  const numGridLines = 4;
  for (let i = 0; i <= numGridLines; i++) {
    const y = padding.top + (i / numGridLines) * chartHeight;
    gridLines.push(y);
  }

  // Format price for labels
  const formatValue = (value: number): string => {
    if (value >= 1000) return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
    if (value >= 1) return value.toFixed(2);
    if (value >= 0.01) return value.toFixed(4);
    return value.toFixed(6);
  };

  // Calculate percentage change
  const startValue = data[0];
  const endValue = data[data.length - 1];
  const percentChange = ((endValue - startValue) / startValue) * 100;
  const isPositive = percentChange >= 0;

  return (
    <View style={[styles.container, { height }]} onLayout={handleLayout}>
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={primaryColor} stopOpacity={0.3} />
            <Stop offset="100%" stopColor={primaryColor} stopOpacity={0.05} />
          </LinearGradient>
        </Defs>

        {/* Grid lines */}
        {showGrid && gridLines.map((y, index) => (
          <Line
            key={`grid-${index}`}
            x1={padding.left}
            y1={y}
            x2={width - padding.right}
            y2={y}
            stroke={primaryColor}
            strokeOpacity={0.2}
            strokeWidth={1}
            strokeDasharray="4,4"
          />
        ))}

        {/* Y-axis labels */}
        {showLabels && gridLines.map((y, index) => {
          const value = maxValue - (index / numGridLines) * range;
          return (
            <SvgText
              key={`label-${index}`}
              x={padding.left - 5}
              y={y + 4}
              fill={primaryColor}
              fontSize={9}
              fontFamily={Platform.OS === 'ios' ? 'Courier' : 'monospace'}
              textAnchor="end"
              opacity={0.7}
            >
              {formatValue(value)}
            </SvgText>
          );
        })}

        {/* Area fill */}
        <Path
          d={areaPath}
          fill="url(#areaGradient)"
        />

        {/* Line */}
        <Path
          d={linePath}
          stroke={primaryColor}
          strokeWidth={2}
          fill="none"
          {...(Platform.OS === 'web' ? {
            style: { filter: `drop-shadow(0 0 4px ${primaryColor})` }
          } : {})}
        />

        {/* Current value dot */}
        <Line
          x1={points[points.length - 1].x - 3}
          y1={points[points.length - 1].y}
          x2={points[points.length - 1].x + 3}
          y2={points[points.length - 1].y}
          stroke={primaryColor}
          strokeWidth={2}
        />

        {/* Label */}
        {label && (
          <SvgText
            x={padding.left}
            y={12}
            fill={primaryColor}
            fontSize={10}
            fontFamily={Platform.OS === 'ios' ? 'Courier' : 'monospace'}
            opacity={0.8}
          >
            {label}
          </SvgText>
        )}

        {/* Percentage change */}
        <SvgText
          x={width - padding.right}
          y={12}
          fill={isPositive ? '#00FF00' : '#FF4444'}
          fontSize={10}
          fontFamily={Platform.OS === 'ios' ? 'Courier' : 'monospace'}
          textAnchor="end"
        >
          {isPositive ? '+' : ''}{percentChange.toFixed(2)}%
        </SvgText>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 4,
    width: '100%',
  },
  noData: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 60,
    opacity: 0.5,
  },
});
