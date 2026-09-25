import { useQuery } from "@tanstack/react-query";
import { getSiaPreference } from "../../api/siaPreferenceApi";
import { queryKeys } from "../../query/queryKeys";

// SIA-001-T06 -- backs the SIA settings page's enable/disable toggle. The
// response is always a complete { enabled } view, even for a user with no
// saved preference document yet (see siaPreferenceService.getPreference's
// own opt-OUT default-state contract: no document means enabled), so this
// hook never needs a separate "does a preference exist" check.
export const useSiaPreferenceQuery = () => {
  return useQuery({
    queryKey: queryKeys.sia.preference(),
    queryFn: ({ signal }) => getSiaPreference(signal),
  });
};
