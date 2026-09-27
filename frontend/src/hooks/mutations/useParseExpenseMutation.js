import { useMutation } from "@tanstack/react-query";
import { parseExpenseText } from "../../api/siaApi";

// Natural-language expense parsing only returns a SUGGESTION to prefill the Add Expense form -- it never persists an expense itself (same contract useBillUploadMutation.js documents for OCR).
export const useParseExpenseMutation = () => {
  return useMutation({
    mutationFn: (text) => parseExpenseText(text),
  });
};
