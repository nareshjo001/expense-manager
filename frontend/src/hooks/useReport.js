import { useQuery } from "@tanstack/react-query";
import { getReport } from "../api/reportApi";

export const useReport = () => {
    return useQuery({
        queryKey: ["report"],
        queryFn: getReport,
    });
};