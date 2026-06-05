export const findMean = (data = []) => {
    const mean = data.reduce((a,b)=>a+b,0) / data.length;
    return mean;
}

export const findVariance = (data = [], mean = 0) => {
    const variance = data.reduce((s,x)=>s + (x-mean)**2,0) / data.length;
    return variance;
}

export const calculateMedian = (values = []) => {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
};

export const findPercentChanges = (data = []) => {
    const deltas = [];
    for (let i = 1; i < data.length; i++) {
        if (data[i - 1] === 0) continue;
        deltas.push((data[i] - data[i - 1]) / data[i - 1]);
    }
    return deltas;
}