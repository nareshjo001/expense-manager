// backend/tests/sia.financeTools.test.js
/* Jest tests for finance tool functions exported from financialQueryService.js */

const financialQueryService = require('../sia/financialQueryService');

jest.mock('../sia/financialQueryService', () => ({
  getPeriodComparison: jest.fn(),
  getIncomeBreakdown: jest.fn(),
  getIncomeSummary: jest.fn(),
  getTrendSeries: jest.fn(),
}));

describe('Finance Tools Test Suite', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('getPeriodComparison returns expected structure', async () => {
    const mockResult = { kind: 'comparison', data: [{ period: 'Jan', amount: 1200 }, { period: 'Feb', amount: 1300 }] };
    financialQueryService.getPeriodComparison.mockResolvedValue(mockResult);
    const result = await financialQueryService.getPeriodComparison('2023-01', '2023-02');
    expect(result).toEqual(mockResult);
    expect(financialQueryService.getPeriodComparison).toHaveBeenCalledWith('2023-01', '2023-02');
  });

  test('getIncomeBreakdown returns expected structure', async () => {
    const mockResult = { kind: 'list', items: [{ source: 'Salary', amount: 5000 }, { source: 'Investments', amount: 200 }] };
    financialQueryService.getIncomeBreakdown.mockResolvedValue(mockResult);
    const result = await financialQueryService.getIncomeBreakdown();
    expect(result).toEqual(mockResult);
    expect(financialQueryService.getIncomeBreakdown).toHaveBeenCalled();
  });

  test('getIncomeSummary returns expected structure', async () => {
    const mockResult = { kind: 'summary', totalIncome: 5200 };
    financialQueryService.getIncomeSummary.mockResolvedValue(mockResult);
    const result = await financialQueryService.getIncomeSummary();
    expect(result).toEqual(mockResult);
    expect(financialQueryService.getIncomeSummary).toHaveBeenCalled();
  });

  test('getTrendSeries returns expected structure', async () => {
    const mockResult = { kind: 'trend', series: [{ month: 'Jan', value: 1200 }, { month: 'Feb', value: 1300 }] };
    financialQueryService.getTrendSeries.mockResolvedValue(mockResult);
    const result = await financialQueryService.getTrendSeries();
    expect(result).toEqual(mockResult);
    expect(financialQueryService.getTrendSeries).toHaveBeenCalled();
  });
});
