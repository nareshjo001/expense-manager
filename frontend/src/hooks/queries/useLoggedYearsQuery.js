import { useQuery } from "@tanstack/react-query";
import { getLoggedYears } from "../../api/chartApi";
import { queryKeys } from "../../query/queryKeys";

// The list of years with logged expense data — independent of any chart filter, so it's fetched once and cached.
export const useLoggedYearsQuery = () => {
  return useQuery({
    queryKey: queryKeys.charts.loggedYears(),
    queryFn: ({ signal }) => getLoggedYears(signal),
  });
};
