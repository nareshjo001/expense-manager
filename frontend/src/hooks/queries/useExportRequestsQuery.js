import { useQuery } from "@tanstack/react-query";
import { listExportRequests } from "../../api/exportApi";
import { queryKeys } from "../../query/queryKeys";

const IN_FLIGHT_STATUSES = new Set(["queued", "processing"]);

// DAT-004 -- backs the Data Export screen's past-requests list. Polls while
// ANY request in the list is still queued/processing, so a background
// export's status (queued -> processing -> ready/failed) updates without a
// manual refresh, and stops polling the moment nothing is in flight.
//
// `refetchInterval` here is a function, not a fixed number -- TanStack
// Query v5's signature for that is `(query) => number | false`, reading the
// current data off `query.state.data` (see
// node_modules/@tanstack/query-core's own type for this option), not the
// pre-v5 `(data, query) =>` shape.
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
