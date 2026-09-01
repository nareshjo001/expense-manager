// backend/tests/ml.predictSpendingForecast.test.js

/**
 * Test the proxy endpoint /ml/predict-spending-forecast.
 * Uses supertest to make an HTTP request against the Express app.
 * The external ML service call is mocked via jest.mock of utils/mlServiceClient.
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../app'); // Express app

const TEST_JWT_SECRET = 'ml-spending-forecast-test-secret';
const originalJwtSecret = process.env.JWT_SECRET;

function authorizationHeader() {
  return `Bearer ${jwt.sign({ _id: '507f1f77bcf86cd799439011' }, TEST_JWT_SECRET)}`;
}

beforeAll(() => {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
});

afterAll(() => {
  if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalJwtSecret;
});

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
  it('returns 200 with forecast data for an authenticated user', async () => {
    const payload = {
      spentSoFar: 1234,
      forecastableSpentSoFar: 200,
      elapsedDay: 10,
      daysInMonth: 30,
    };

    const res = await request(app)
      .post('/ml/predict-spending-forecast')
      .set('Content-Type', 'application/json')
      .set('Authorization', authorizationHeader())
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

  it('rejects an unauthenticated request before calling the ML client', async () => {
    const payload = {
      spentSoFar: 1234,
      forecastableSpentSoFar: 200,
      elapsedDay: 10,
      daysInMonth: 30,
    };

    const client = require('../utils/mlServiceClient');
    client.requestSpendingForecast.mockClear();

    const res = await request(app)
      .post('/ml/predict-spending-forecast')
      .set('Content-Type', 'application/json')
      .send(payload);

    expect(res.status).toBe(401);
    expect(client.requestSpendingForecast).not.toHaveBeenCalled();
  });
});
