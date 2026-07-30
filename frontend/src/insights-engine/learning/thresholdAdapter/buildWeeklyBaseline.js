import { findMean, findVariance } from "../../statistics/statsCalculation";

// Computes the mean, standard deviation, and volatility (coefficient of variation) of weekly totals.
export const buildWeeklyBaseline =  (weeklyData = []) => {
    if (!Array.isArray(weeklyData)) return null;

    const values = weeklyData.map(w => w.total);
    if(values.length < 5) return null;

    const mean = findMean(values);
    const variance = findVariance(values, mean);
    const std = Math.sqrt(variance);

    return {
        mean,
        std,
        volatility: mean > 0 ? std / mean : 0
    };
}