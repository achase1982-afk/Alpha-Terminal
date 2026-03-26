import type { Candle } from "@workspace/api-client-react";

// Calculate Simple Moving Average
export function calculateSMA(data: Candle[], period: number) {
  const result = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push({ time: data[i].datetime, value: null });
      continue;
    }
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += data[i - j].close;
    }
    result.push({ time: data[i].datetime, value: sum / period });
  }
  return result;
}

// Calculate Bollinger Bands
export function calculateBollingerBands(data: Candle[], period: number = 20, multiplier: number = 2) {
  const upper = [];
  const lower = [];
  const middle = calculateSMA(data, period);

  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      upper.push({ time: data[i].datetime, value: null });
      lower.push({ time: data[i].datetime, value: null });
      continue;
    }
    
    const sma = middle[i].value;
    if (sma === null) continue;

    let varianceSum = 0;
    for (let j = 0; j < period; j++) {
      varianceSum += Math.pow(data[i - j].close - sma, 2);
    }
    
    const stdDev = Math.sqrt(varianceSum / period);
    upper.push({ time: data[i].datetime, value: sma + stdDev * multiplier });
    lower.push({ time: data[i].datetime, value: sma - stdDev * multiplier });
  }

  return { upper, lower, middle };
}
