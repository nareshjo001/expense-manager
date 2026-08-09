import { useMutation } from "@tanstack/react-query";
import { askSia } from "../../api/siaApi";

// Each SIA question is a one-off call, not a cached/reusable query -- there
// is no query key and no other query key (expense, budget, report, income,
// chart) is affected by asking SIA a question. The SIA session list IS
// affected, but that invalidation is the caller's decision, made once an
// answer actually lands.
//
// `retry: 0` is explicit rather than inherited: an automatic retry would
// resend the same clientMessageId without the conversation UI knowing,
// which makes the visible failed/pending state disagree with what the
// server is actually doing. Retrying is a deliberate user action, driven
// by the conversation state.
export const useSiaAskMutation = () => {
  return useMutation({
    mutationFn: askSia,
    retry: 0,
  });
};
