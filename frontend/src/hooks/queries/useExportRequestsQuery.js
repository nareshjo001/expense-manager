import { useQuery } from "@tanstack/react-query";
import { listExportRequests } from "../../api/exportApi";
import { queryKeys } from "../../query/queryKeys";

const IN_FLIGHT_STATUSES = new Set(["queued", "processing"]);

// Backs the Data Export screen's past-requests list.
export const useExportRequestsQuery = () => {
  return useQuery({
    queryKey: queryKeys.exports.lists(),
    queryFn: ({ signal }) => listExportRequests(signal),
    refetchInterval: (query) => {
      const requests = query.state.data?.data;
      return Array.isArray(requests) && requests.some((r) => IN_FLIGHT_STATUSES.has(r.status))
        ? 3000
        : false;
    },
  });
};
