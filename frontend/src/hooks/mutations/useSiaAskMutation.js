import { useMutation } from "@tanstack/react-query";
import { askSia } from "../../api/siaApi";

// Each SIA question is a one-off call, not a cached/reusable query -- there
export const useSiaAskMutation = () => {
  return useMutation({
    mutationFn: askSia,
    retry: 0,
  });
};
