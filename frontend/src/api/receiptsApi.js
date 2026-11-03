import api from "./axios";

// Js). Every receipt-inbox endpoint answers with this app's usual { message, success, data, errorCode?

// `linked` is left out of `params` entirely when it isn't a boolean, so an
// unset filter never sends `linked=undefined` on the wire.
export const listReceipts = async ({ reviewStatus, linked } = {}, signal) => {
  const { data } = await api.get("/api/receipts", {
    params: {
      ...(reviewStatus ? { reviewStatus } : {}),
      ...(typeof linked === "boolean" ? { linked } : {}),
    },
    signal,
  });
  return data;
};

export const getReceipt = async (id, signal) => {
  const { data } = await api.get(`/api/receipts/${id}`, { signal });
  return data;
};

// Js's onError) to map to a message, same split every other mutation wrapper in this app uses.
export const linkReceipt = async (id, expenseId) => {
  const { data } = await api.post(`/api/receipts/${id}/link`, { expenseId });
  return data;
};

// Idempotent per the contract -- unlinking an already-unlinked receipt is still a 200, not an error, so callers never need to guard this call on the receipt's current linkedExpenseId.
export const unlinkReceipt = async (id) => {
  const { data } = await api.post(`/api/receipts/${id}/unlink`);
  return data;
};

// `corrections` is optional on the contract -- omitted entirely (not sent as `{ corrections: undefined }`) when there's nothing to correct, so a plain "mark as reviewed" and a "mark as reviewed with these fixes" look identical to the server except for whether the key is present at all.
export const markReceiptReviewed = async (id, corrections) => {
  const { data } = await api.post(
    `/api/receipts/${id}/reviewed`,
    corrections && Object.keys(corrections).length > 0 ? { corrections } : {}
  );
  return data;
};

export const deleteReceipt = async (id) => {
  const { data } = await api.delete(`/api/receipts/${id}`);
  return data;
};

// Fetches a receipt's image as a Blob through the authenticated axios instance, rather than pointing a plain <img src> at it directly.
export const getReceiptImageBlob = async (imageUrl, signal) => {
  const response = await api.get(imageUrl, { responseType: "blob", signal });
  return response.data;
};

// Fetches this receipt's possible duplicate candidates (exact file matches and probable merchant/date/amount matches), same envelope shape as every other receipt-inbox endpoint above -- empty `data` array is the normal "nothing found" case, not an error.
export const getReceiptDuplicates = async (id, signal) => {
  const { data } = await api.get(`/api/receipts/${id}/duplicates`, { signal });
  return data;
};

// Records the user's decision on a receipt's duplicate candidates -- either keeping it as its own receipt ("confirmed_new") or linking it to an existing receipt it duplicates ("linked_existing", which also needs `duplicateOfReceiptId`).
export const recordDuplicateDecision = async (id, { decision, duplicateOfReceiptId } = {}) => {
  const { data } = await api.post(`/api/receipts/${id}/duplicate-decision`, {
    decision,
    ...(duplicateOfReceiptId ? { duplicateOfReceiptId } : {}),
  });
  return data;
};
