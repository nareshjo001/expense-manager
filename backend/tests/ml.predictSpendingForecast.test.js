// backend/tests/ml.predictSpendingForecast.test.js

/**
 * Test the proxy endpoint /ml/predict-spending-forecast.
 * Uses supertest to make an HTTP request against the Express app.
 * The external ML service call is mocked via jest.mock of utils/mlServiceClient.
 */

const request = require('supertest');
const app = require('../app'); // Express app

// Mock the ML service client module
jest.mock('../utils/mlServiceClient', () => {
  const original = jest.requireActual('../utils/mlServiceClient');
  return {
    ...original,
    requestSpendingForecast: jest.fn().mockResolvedValue({
      success: true,
      data: {
        predictedRemaining: 1565.3,
        predictedTotal: 2799.3,
        range: { lower: 143.71, upper: 17421.29 },
        confidenceScore: 0,
        modelVersion: 'spend-forecast-gbdt-v1.0.0',
        isFallback: false,
      },
    }),
  };
});

describe('POST /ml/predict-spending-forecast', () => {
  it('returns 200 with forecast data when token header is provided', async () => {
    const payload = {
      spentSoFar: 1234,
      forecastableSpentSoFar: 200,
      elapsedDay: 10,
      daysInMonth: 30,
    };

    const res = await request(app)
      .post('/ml/predict-spending-forecast')
      .set('Content-Type', 'application/json')
      .set('X-ML-Operations-Token', 'test-token')
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
    expect(res.body).toHaveProperty('data');
    expect(res.body.data).toMatchObject({
      success: true,
      predictedRemaining: 1565.3,
      predictedTotal: 2799.3,
    });
  });

  it('returns 200 even if token header is missing (mocked service ignores it)', async () => {
    const payload = {
      spentSoFar: 1234,
      forecastableSpentSoFar: 200,
      elapsedDay: 10,
      daysInMonth: 30,
    };

    const res = await request(app)
      .post('/ml/predict-spending-forecast')
      .set('Content-Type', 'application/json')
      .send(payload);

    expect(res.status).toBe(200);
  });
});
