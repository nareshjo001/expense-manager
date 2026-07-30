import { ThemeContext } from '../contexts/ThemeContext';
import {
    customStyles,
    getSelectStyles
} from '../charts/essentials/chartEssentials';
import { LightThemeGradients, DarkThemeGradients } from '../charts/essentials/chartGradients';

import TrendChartWrapper from '../charts/linechart/TrendChartWrapper';
import MultiTrendChartWrapper from '../charts/linechart/MultiTrendChartWrapper';
import BarChartWrapper from '../charts/barchart/BarChartWrapper';
import PieChartWrapper from '../charts/piechart/PieChartWrapper';

// Barrel re-export of chart wrappers, styles, and gradients used by the chart pages.
export {
    ThemeContext,
    customStyles,
    getSelectStyles,
    TrendChartWrapper,
    MultiTrendChartWrapper,
    BarChartWrapper,
    PieChartWrapper,
    LightThemeGradients,
    DarkThemeGradients
}