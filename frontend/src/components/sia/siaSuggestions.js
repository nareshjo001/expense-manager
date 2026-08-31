// Starter questions shown when a conversation is empty.
//
// These prompts are interpreted by SIA's LLM semantic router. The router
// may choose only from the backend's validated, read-only financial-data
// capability catalog; suggestions must not be phrased around regex rules.
export const SIA_SUGGESTIONS = [
  {
    id: "spending-current",
    text: "How much did I spend this month?",
  },
  {
    id: "category-highest",
    text: "Which category am I spending the most on?",
  },
  {
    id: "comparison-month",
    text: "How does this month compare to last month?",
  },
  {
    id: "income-expenses",
    text: "What's my income vs expenses this month?",
  },
  {
    id: "budget-track",
    text: "Am I on track with my budget?",
  },
  {
    id: "spending-trend",
    text: "Show me my spending trend over the last 3 months.",
  },
  {
    id: "unusual-recent",
    text: "Were there any unusual expenses recently?",
  },
  {
    id: "cash-flow",
    text: "What is my net cash flow this month?",
  },
];

export default SIA_SUGGESTIONS;
