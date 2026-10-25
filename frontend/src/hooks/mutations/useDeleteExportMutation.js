import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteExport } from "../../api/exportApi";
import { queryKeys } from "../../query/queryKeys";

export const useDeleteExportMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => deleteExport(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.exports.lists() });
    },
  });
};
