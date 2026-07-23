module.exports = {
  weights: {
    budget: 30,
    trend: 20,
    habit: 25,
    category: 15,
    stability: 10,
  },

  trend: {
    direction: {
      Decreasing: 20,
      Stable: 15,
      Increasing: 5,
    }
  },

  habits: {
    impulse: {
      low: 15,
      medium: 30,

      scores: {
        low: 10,
        medium: 6,
        high: 2
      }
    },

    micro: {
      low: 10,
      medium: 20,

      scores: {
        low: 5,
        medium: 3,
        high: 1
      }
    },

    weekendRatio: {
      balanced: 1.2,

      scores: {
        balanced: 5,
        unbalanced: 2
      }
    },

    subscriptionPenalty: {
      threshold: 8,
      penalty: 3
    },

    shoppingFrequencyPenalty: {
      threshold: 15,
      penalty: 2
    }
  },

  stability: {
    maxScore: 10
  },

  riskLevels: [
    {
      min: 80,
      label: "Low",
      color: "green"
    },
    {
      min: 60,
      label: "Moderate",
      color: "yellow"
    },
    {
      min: 40,
      label: "High",
      color: "orange"
    },
    {
      min: 0,
      label: "Critical",
      color: "red"
    }
  ]
};