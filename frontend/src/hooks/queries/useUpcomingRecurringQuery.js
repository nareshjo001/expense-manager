import { useQuery } from "@tanstack/react-query";
import { getUpcomingRecurring } from "../../api/recurringApi";
import { queryKeys } from "../../query/queryKeys";

// REC-003 -- queries projected upcoming recurring expenses.
// Integrated with TanStack Query so mutations from the master management surface
// (pause, resume, end, edit) automatically invalidate and refetch this projection.
export const useUpcomingRecurringQuery = (options = {}) => {
  return useQuery({
    queryKey: queryKeys.recurring.upcoming(),
    queryFn: ({ signal }) => getUpcomingRecurring(signal),
    refetchOnMount: "always",
    ...options,
  });
};
