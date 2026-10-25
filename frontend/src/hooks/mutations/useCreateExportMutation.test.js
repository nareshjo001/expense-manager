import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createExport } from "../../api/exportApi";
import { queryKeys } from "../../query/queryKeys";
import { useCreateExportMutation } from "./useCreateExportMutation";

jest.mock("@tanstack/react-query", () => ({
  useMutation: jest.fn(),
  useQueryClient: jest.fn(),
}));

jest.mock("../../api/exportApi", () => ({
  createExport: jest.fn(),
}));

describe("useCreateExportMutation", () => {
  let capturedOptions;
  let invalidateQueries;

  beforeEach(() => {
    invalidateQueries = jest.fn();
    useQueryClient.mockReturnValue({ invalidateQueries });
    useMutation.mockImplementation((options) => {
      capturedOptions = options;
      return { mutate: jest.fn(), isPending: false };
    });
    useCreateExportMutation();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("passes createExport as the mutationFn", () => {
    expect(capturedOptions.mutationFn).toBeDefined();
    const payload = { domain: "expenses", format: "csv" };
    capturedOptions.mutationFn(payload);
    expect(createExport).toHaveBeenCalledWith(payload);
  });

  it("invalidates exports list query on queued export success", () => {
    const queuedResult = {
      success: true,
      message: "Export queued",
      data: { id: "exp-1", status: "queued", domain: "expenses", format: "csv" },
    };

    capturedOptions.onSuccess(queuedResult);

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.exports.lists(),
    });
  });

  it("triggers browser download and invalidates exports list query on sync export success", () => {
    const createObjectURLMock = jest.fn(() => "blob:http://localhost/test-blob");
    const revokeObjectURLMock = jest.fn();
    window.URL.createObjectURL = createObjectURLMock;
    window.URL.revokeObjectURL = revokeObjectURLMock;

    const appendChildSpy = jest.spyOn(document.body, "appendChild");
    const blob = new Blob(["test,content"], { type: "text/csv" });
    const syncResult = {
      file: true,
      blob,
      filename: "balensia-export-expenses.csv",
      contentType: "text/csv",
    };

    capturedOptions.onSuccess(syncResult);

    expect(createObjectURLMock).toHaveBeenCalledWith(blob);
    expect(appendChildSpy).toHaveBeenCalled();
    expect(revokeObjectURLMock).toHaveBeenCalledWith("blob:http://localhost/test-blob");
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.exports.lists(),
    });

    appendChildSpy.mockRestore();
  });
});
