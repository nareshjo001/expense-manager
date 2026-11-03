import { useMutation, useQueryClient } from "@tanstack/react-query";
import { generateAiMonthlySummary } from "../../api/aiSummaryApi";
import { queryKeys } from "../../query/queryKeys";

// RecordRegeneration). The generated summary itself is NOT cached under a query key -- there is no GET endpoint for "the last generated summar.
export const useGenerateAiMonthlySummaryMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => generateAiMonthlySummary(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.aiSummary.preference() });
    },
  });
};
