import { useQuery } from "@tanstack/react-query";
import { getReport } from "../api/reportApi";
import { queryKeys } from "../query/queryKeys";

// Fetches and caches the aggregated financial report under the shared report query key.
export const useReport = () => {
    return useQuery({
        queryKey: queryKeys.reports.all,
        // Forwards TanStack's abort signal so a superseded fetch is actually cancelled at the transport level.
        queryFn: ({ signal }) => getReport(signal),
    });
};