import { useQuery } from "@tanstack/react-query";
import { getSiaPreference } from "../../api/siaPreferenceApi";
import { queryKeys } from "../../query/queryKeys";

// Backs the SIA settings page's enable/disable toggle.
export const useSiaPreferenceQuery = () => {
  return useQuery({
    queryKey: queryKeys.sia.preference(),
    queryFn: ({ signal }) => getSiaPreference(signal),
  });
};
