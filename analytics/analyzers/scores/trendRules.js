module.exports = {
  trend: {
    // Decreasing spend scores HIGHEST — this is a financial-health
    // score, not an "activity" score. Keep that semantic in mind if
    // you add more direction labels later.
    direction: {
      Decreasing: 20,
      Stable: 15,
      Increasing: 5,
    },
    maxScore: 20,
  },
};