import { useMutation } from "@tanstack/react-query";
import { uploadBill } from "../../api/billApi";

// Bill upload only returns OCR-parsed receipt data to prefill the Add Expense form — it never persists an
export const useBillUploadMutation = () => {
  return useMutation({
    mutationFn: (file) => uploadBill(file),
  });
};
