import { useMutation } from "@tanstack/react-query";
import { uploadBill } from "../../api/billApi";

// Bill upload only returns OCR-parsed receipt data to prefill the Add Expense form — it never persists an
// expense itself, so there is nothing to invalidate here. The eventual Add Expense submit already invalidates
// expenses/budgets/reports/charts through its own mutation.
export const useBillUploadMutation = () => {
  return useMutation({
    mutationFn: (file) => uploadBill(file),
  });
};
