import { useMutation } from "@tanstack/react-query";
import { askSia } from "../../api/siaApi";

// Each SIA question is a one-off call, not a cached/reusable query -- there
// is no query key, no cache to invalidate, and no other query key (expense,
// budget, report, income, chart) is affected by asking SIA a question.
export const useSiaAskMutation = () => {
  return useMutation({
    mutationFn: askSia,
  });
};
