import { useQuery } from "@tanstack/react-query";
import { listRecurringDefinitions } from "../../api/recurringApi";
import { queryKeys } from "../../query/queryKeys";

// REC-002-T05 -- backs the recurring-definition management screen (every
// definition regardless of status, unlike the REC-003 upcoming projection
// which only ever returns active ones).
export const useRecurringDefinitionsQuery = () => {
  return useQuery({
    queryKey: queryKeys.recurring.lists(),
    queryFn: ({ signal }) => listRecurringDefinitions(signal),
  });
};
